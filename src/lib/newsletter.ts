import { z } from 'zod';
import type { PluginContext, StorageCollection, ContentAccess } from 'emdash';
import { confirmationEmail, digestEmail } from '../emails/newsletter';
import {
  newsletterExcerpt,
  newsletterFrom,
  newsletterHash,
  newsletterSettingsSchema,
  newsletterUrl,
  nextNewsletterSend,
  type DigestPost,
} from './newsletter-model';
import { daySchema } from './model';

const hour = 3600_000;
const subscriberSchema = z.object({
  email: z.email(),
  confirmed: z.boolean(),
  createdAt: z.number(),
  requestedAt: z.number(),
  confirmedAt: z.number().optional(),
  consentVersion: z.literal('japan-journal-v1'),
});
const confirmationSchema = z.object({
  emailKey: z.string(),
  expiresAt: z.number(),
  consumed: z.boolean(),
  leaseUntil: z.number().optional(),
});
const runSchema = z.object({
  status: z.enum([
    'preparing',
    'sending',
    'sent',
    'uncertain',
    'failed',
    'draft',
  ]),
  createdAt: z.number(),
  postIds: z.array(z.string()),
  broadcastId: z.string().optional(),
  postHashes: z.record(z.string(), z.string()).optional(),
  leaseUntil: z.number().optional(),
});
const stateSchema = z.object({
  nextSend: z.number(),
  lastRun: z.string().optional(),
});
const settingsKey = 'configuration';
type NewsletterNamespace = Pick<
  PluginContext['kv'],
  'set' | 'delete' | 'compareAndSet' | 'compareAndDelete'
> & {
  get(key: string): Promise<unknown>;
  getVersioned(
    key: string,
  ): Promise<{ value: unknown; revision: string } | null>;
};
export type NewsletterContext = {
  storage: PluginContext['storage'];
  kv: NewsletterNamespace;
  settings: Pick<PluginContext['settings'], 'set'> & {
    get(key: string): Promise<unknown>;
  };
  content?: Pick<ContentAccess, 'get' | 'list'>;
  http?: PluginContext['http'];
  cron?: PluginContext['cron'];
  log: Pick<PluginContext['log'], 'warn'>;
};

function store(ctx: NewsletterContext, name: string): StorageCollection {
  const collection = ctx.storage[name];
  if (!collection) throw new Error('Newsletter storage unavailable');
  return collection;
}
async function newsletterSettings(ctx: NewsletterContext) {
  return newsletterSettingsSchema.parse((await ctx.kv.get(settingsKey)) ?? {});
}
async function provider(
  ctx: NewsletterContext,
  path: string,
  method = 'GET',
  body?: unknown,
  idempotency?: string,
  candidateKey?: string,
) {
  const key = z
    .string()
    .min(1)
    .parse(candidateKey ?? (await ctx.settings.get('apiKey')));
  if (!ctx.http) throw new Error('Newsletter transport unavailable');
  const response = await ctx.http.fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok)
    throw new Error(
      `Newsletter provider request failed (${String(response.status)})`,
    );
  if (response.status === 204) return null;
  const value: unknown = await response.json();
  return value;
}

async function limit(
  ctx: NewsletterContext,
  key: string,
  maximum: number,
  window: number,
  now: number,
) {
  const buckets = store(ctx, 'limits');
  const id = `${key}:${String(Math.floor(now / window))}`;
  const schema = z.object({ count: z.number(), expiresAt: z.number() });
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await buckets.getVersioned(id);
    const current = previous
      ? schema.parse(previous.value)
      : { count: 0, expiresAt: now + window * 2 };
    if (current.count >= maximum) return false;
    const saved = await buckets.compareAndSet(id, previous?.revision ?? null, {
      ...current,
      count: current.count + 1,
    });
    if (saved.applied) return true;
  }
  return false;
}

export async function requestSubscription(
  ctx: NewsletterContext,
  input: unknown,
  ip: string,
  publicUrl: string,
  now = Date.now(),
) {
  const parsed = z
    .object({
      email: z.email().max(254),
      website: z.string().max(200).default(''),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, message: 'enter a valid email address.' };
  if (parsed.data.website) return { ok: true };
  if (
    !(await ctx.settings.get('apiKey')) ||
    !(await ctx.settings.get('segmentId'))
  )
    return {
      ok: false,
      message: 'signups are temporarily unavailable. please try again later.',
    };
  if (
    !(await limit(ctx, `ip:${await newsletterHash(ip)}`, 5, hour, now)) ||
    !(await limit(ctx, 'daily', 90, 24 * hour, now))
  )
    return { ok: true };
  const email = parsed.data.email.toLowerCase();
  const emailKey = await newsletterHash(email);
  const subscribers = store(ctx, 'subscribers');
  const previous = await subscribers.getVersioned(emailKey);
  const current = previous ? subscriberSchema.parse(previous.value) : undefined;
  if (current && current.requestedAt + hour > now) return { ok: true };
  const saved = await subscribers.compareAndSet(
    emailKey,
    previous?.revision ?? null,
    {
      email,
      confirmed: current?.confirmed ?? false,
      createdAt: current?.createdAt ?? now,
      requestedAt: now,
      consentVersion: 'japan-journal-v1',
      ...(current?.confirmedAt ? { confirmedAt: current.confirmedAt } : {}),
    },
  );
  if (!saved.applied) return { ok: true };
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const tokenHash = await newsletterHash(token);
  await store(ctx, 'confirmations').put(tokenHash, {
    emailKey,
    expiresAt: now + 24 * hour,
    consumed: false,
  });
  try {
    const emailBody = await confirmationEmail(
      `${publicUrl}/newsletter/confirm?token=${token}`,
    );
    await provider(
      ctx,
      '/emails',
      'POST',
      {
        from: newsletterFrom,
        to: [email],
        subject: 'confirm your japan journal subscription',
        ...emailBody,
      },
      `japan-confirm-${tokenHash}`,
    );
    return { ok: true };
  } catch {
    // Failed delivery must remain retryable. Do not disclose the provider error or address.
    await subscribers.compareAndSet(emailKey, saved.revision, {
      email,
      confirmed: current?.confirmed ?? false,
      createdAt: current?.createdAt ?? now,
      requestedAt: 0,
      consentVersion: 'japan-journal-v1',
      ...(current?.confirmedAt ? { confirmedAt: current.confirmedAt } : {}),
    });
    return {
      ok: false,
      message: 'we couldn’t send the confirmation. please try again.',
    };
  }
}

export async function confirmSubscription(
  ctx: NewsletterContext,
  input: unknown,
  now = Date.now(),
) {
  const parsed = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, message: 'this confirmation link is invalid.' };
  const tokenHash = await newsletterHash(parsed.data.token);
  const confirmations = store(ctx, 'confirmations');
  const stored = await confirmations.getVersioned(tokenHash);
  if (!stored)
    return {
      ok: false,
      message: 'this link has expired. please sign up again.',
    };
  const confirmation = confirmationSchema.parse(stored.value);
  if (confirmation.consumed) return { ok: true };
  if (confirmation.expiresAt < now)
    return {
      ok: false,
      message: 'this link has expired. please sign up again.',
    };
  if ((confirmation.leaseUntil ?? 0) > now)
    return {
      ok: false,
      message: 'confirmation is in progress. please try again shortly.',
    };
  const claim = await confirmations.compareAndSet(tokenHash, stored.revision, {
    ...confirmation,
    leaseUntil: now + 120_000,
  });
  if (!claim.applied)
    return { ok: false, message: 'please try confirming again.' };
  const subscribers = store(ctx, 'subscribers');
  const storedSubscriber = await subscribers.getVersioned(
    confirmation.emailKey,
  );
  if (!storedSubscriber) return { ok: false, message: 'please sign up again.' };
  const subscriber = subscriberSchema.parse(storedSubscriber.value);
  try {
    const segmentId = z
      .string()
      .min(1)
      .parse(await ctx.settings.get('segmentId'));
    // Explicit reconfirmation is required before a previously unsubscribed
    // contact may be subscribed again. Repeated confirmation is idempotent.
    const contactPath = `/contacts/${encodeURIComponent(subscriber.email)}`;
    const existing = await provider(ctx, contactPath);
    if (existing)
      await provider(ctx, contactPath, 'PATCH', { unsubscribed: false });
    else
      await provider(ctx, '/contacts', 'POST', {
        email: subscriber.email,
        unsubscribed: false,
      });
    await provider(
      ctx,
      `/contacts/${encodeURIComponent(subscriber.email)}/segments/${encodeURIComponent(segmentId)}`,
      'POST',
    );
    const updated = await subscribers.compareAndSet(
      confirmation.emailKey,
      storedSubscriber.revision,
      { ...subscriber, confirmed: true, confirmedAt: now },
    );
    if (!updated.applied)
      return { ok: false, message: 'please try confirming again.' };
    await confirmations.compareAndSet(tokenHash, claim.revision, {
      ...confirmation,
      consumed: true,
    });
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: 'confirmation is temporarily unavailable. please try again.',
    };
  } finally {
    await confirmations.compareAndSet(tokenHash, claim.revision, {
      ...confirmation,
      leaseUntil: 0,
    });
  }
}

export async function pendingDigestPosts(
  ctx: NewsletterContext,
): Promise<DigestPost[]> {
  if (!ctx.content) throw new Error('Newsletter content unavailable');
  const posts: DigestPost[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.content.list('posts', {
      limit: 100,
      cursor,
      where: { status: 'published' },
      orderBy: { day: 'asc' },
    });
    const sent = await store(ctx, 'sent').getMany(
      page.items.map((item) => item.id),
    );
    for (const item of page.items) {
      // ContentAccess reads the live columns, not the staged revision.
      if (
        item.status !== 'published' ||
        !item.slug ||
        item.data.demo ||
        sent.has(item.id)
      )
        continue;
      const parsed = z
        .object({ title: z.string(), day: daySchema })
        .safeParse(item.data);
      if (!parsed.success) continue;
      posts.push({
        id: item.id,
        ...parsed.data,
        url: `${newsletterUrl}/posts/${encodeURIComponent(item.slug)}`,
        excerpt: newsletterExcerpt(item.data.content),
      });
      if (posts.length === 24) return posts;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return posts;
}

async function completeRun(
  ctx: NewsletterContext,
  id: string,
  run: z.infer<typeof runSchema>,
) {
  await store(ctx, 'sent').putMany(
    run.postIds.map((postId) => ({ id: postId, data: { runId: id } })),
  );
  await store(ctx, 'runs').put(id, { ...run, status: 'sent' });
}

export async function checkNewsletterRun(ctx: NewsletterContext) {
  const state = stateSchema.parse(await ctx.kv.get('state'));
  if (!state.lastRun) return;
  const run = runSchema.parse(await store(ctx, 'runs').get(state.lastRun));
  if (run.status === 'sent') return;
  if (
    ['preparing', 'sending'].includes(run.status) &&
    (run.leaseUntil ?? run.createdAt + 120_000) > Date.now()
  )
    return;
  if (run.broadcastId) {
    const broadcast = z
      .object({ status: z.string() })
      .parse(
        await provider(
          ctx,
          `/broadcasts/${encodeURIComponent(run.broadcastId)}`,
        ),
      );
    if (broadcast.status === 'sent') await completeRun(ctx, state.lastRun, run);
    else if (broadcast.status === 'draft')
      await store(ctx, 'runs').put(state.lastRun, { ...run, status: 'draft' });
  } else if (run.createdAt + 120_000 < Date.now()) {
    // Only draft broadcasts are created before the ID is durably saved.
    await store(ctx, 'runs').put(state.lastRun, { ...run, status: 'failed' });
  }
}

async function resumeNewsletterRun(ctx: NewsletterContext) {
  const state = stateSchema.parse(await ctx.kv.get('state'));
  if (!state.lastRun) throw new Error('No saved newsletter');
  const runs = store(ctx, 'runs');
  const stored = await runs.getVersioned(state.lastRun);
  if (!stored) throw new Error('No saved newsletter');
  const run = runSchema.parse(stored.value);
  if (run.status !== 'draft' || !run.broadcastId)
    throw new Error('Check delivery before resuming a saved draft');
  const claim = await runs.compareAndSet(state.lastRun, stored.revision, {
    ...run,
    status: 'sending',
    leaseUntil: Date.now() + 120_000,
  });
  if (!claim.applied)
    throw new Error('This newsletter is already being checked');
  try {
    const broadcast = z
      .object({ status: z.string() })
      .parse(
        await provider(
          ctx,
          `/broadcasts/${encodeURIComponent(run.broadcastId)}`,
        ),
      );
    if (broadcast.status === 'draft') {
      // A previously prepared draft may contain entries that were later
      // unpublished. Check current live entries before any recovery send.
      for (const id of run.postIds) {
        const post = await ctx.content?.get('posts', id);
        if (
          !post ||
          post.status !== 'published' ||
          post.data.demo ||
          !post.slug ||
          !run.postHashes ||
          run.postHashes[id] !==
            (await newsletterHash(
              JSON.stringify({
                id: post.id,
                title: post.data.title,
                day: post.data.day,
                url: `${newsletterUrl}/posts/${encodeURIComponent(post.slug)}`,
                excerpt: newsletterExcerpt(post.data.content),
              }),
            ))
        )
          throw new Error('Publication changed');
      }
      await provider(
        ctx,
        `/broadcasts/${encodeURIComponent(run.broadcastId)}/send`,
        'POST',
        {},
      );
    } else if (broadcast.status !== 'sent')
      throw new Error('Delivery is still uncertain');
    // Always reuse the saved provider ID, even if another request sent it while
    // we were checking. An uncertain run never gets a replacement broadcast.
    await completeRun(ctx, state.lastRun, run);
  } catch {
    await runs.compareAndSet(state.lastRun, claim.revision, {
      ...run,
      status: 'uncertain',
    });
    throw new Error(
      'Delivery still needs checking. No replacement email was created.',
    );
  }
}

export async function runNewsletter(
  ctx: NewsletterContext,
  ownerEmail: string,
  now = Date.now(),
) {
  const startedAt = Date.now();
  const settings = await newsletterSettings(ctx);
  if (!settings.enabled || !(await ctx.settings.get('apiKey')) || !ownerEmail)
    return;
  const previousLock = await ctx.kv.getVersioned('send-lock');
  const expires = z.number().safeParse(previousLock?.value);
  if (expires.success && expires.data > now) return;
  const lock = await ctx.kv.compareAndSet(
    'send-lock',
    previousLock?.revision ?? null,
    now + 120_000,
  );
  if (!lock.applied) return;
  try {
    const state = stateSchema.parse(
      (await ctx.kv.get('state')) ?? {
        nextSend: nextNewsletterSend(settings, now),
      },
    );
    if (state.lastRun) {
      const last = runSchema.parse(await store(ctx, 'runs').get(state.lastRun));
      if (['preparing', 'sending', 'uncertain', 'draft'].includes(last.status))
        return;
    }
    if (now < state.nextSend) return;
    const posts = await pendingDigestPosts(ctx);
    const id = crypto.randomUUID();
    if (!posts.length) {
      await ctx.kv.set('state', {
        ...state,
        nextSend: nextNewsletterSend(settings, now, now),
      });
      return;
    }
    const runs = store(ctx, 'runs');
    const postHashes: Record<string, string> = {};
    for (const post of posts)
      postHashes[post.id] = await newsletterHash(JSON.stringify(post));
    const run = {
      status: 'preparing',
      createdAt: now,
      postIds: posts.map((post) => post.id),
      postHashes,
    };
    await runs.put(id, run);
    await ctx.kv.set('state', {
      nextSend: nextNewsletterSend(settings, now, now),
      lastRun: id,
    });
    try {
      const segmentId = z
        .string()
        .min(1)
        .parse(await ctx.settings.get('segmentId'));
      const body = await digestEmail(posts);
      const created = z.object({ id: z.string() }).parse(
        await provider(ctx, '/broadcasts', 'POST', {
          from: newsletterFrom,
          reply_to: ownerEmail,
          segment_id: segmentId,
          subject: 'recent days in japan',
          name: `japan-${id}`,
          ...body,
        }),
      );
      const sending = { ...run, status: 'sending', broadcastId: created.id };
      await runs.put(id, sending);
      // Recheck the live records immediately before dispatch. Staged revisions
      // and entries unpublished during preparation never enter a send.
      for (const post of posts) {
        const live = await ctx.content?.get('posts', post.id);
        if (
          !live ||
          live.status !== 'published' ||
          live.data.demo ||
          live.data.title !== post.title ||
          live.data.day !== post.day ||
          `${newsletterUrl}/posts/${encodeURIComponent(live.slug ?? '')}` !==
            post.url ||
          newsletterExcerpt(live.data.content) !== post.excerpt
        )
          throw new Error('Publication changed');
      }
      if (!(await newsletterSettings(ctx)).enabled)
        throw new Error('Newsletter paused');
      const currentLock = await ctx.kv.getVersioned('send-lock');
      if (
        currentLock?.revision !== lock.revision ||
        Date.now() - startedAt >= 120_000
      )
        throw new Error('Send lease expired');
      await provider(
        ctx,
        `/broadcasts/${encodeURIComponent(created.id)}/send`,
        'POST',
        {},
      );
      await completeRun(ctx, id, runSchema.parse(sending));
    } catch {
      const existing = runSchema.parse(await runs.get(id));
      await runs.put(id, { ...existing, status: 'uncertain' });
      ctx.log.warn('newsletter_send_needs_review');
    }
  } finally {
    await ctx.kv.compareAndDelete('send-lock', lock.revision);
  }
}

export async function newsletterStatus(ctx: NewsletterContext) {
  const settings = await newsletterSettings(ctx);
  const state = stateSchema.parse(
    (await ctx.kv.get('state')) ?? {
      nextSend: nextNewsletterSend(settings, Date.now()),
    },
  );
  const last = state.lastRun
    ? runSchema.parse(await store(ctx, 'runs').get(state.lastRun))
    : null;
  return {
    settings,
    configured: Boolean(
      (await ctx.settings.get('apiKey')) &&
      (await ctx.settings.get('segmentId')),
    ),
    confirmed: await store(ctx, 'subscribers').count({ confirmed: true }),
    posts: await pendingDigestPosts(ctx),
    nextSend: new Date(state.nextSend).toISOString(),
    lastRun:
      last && state.lastRun
        ? {
            id: state.lastRun,
            status: last.status,
            createdAt: last.createdAt,
            postCount: last.postIds.length,
          }
        : null,
  };
}

export async function configureNewsletter(
  ctx: NewsletterContext,
  input: unknown,
  ownerEmail: string,
) {
  const parsed = z
    .discriminatedUnion('action', [
      z.object({
        action: z.literal('settings'),
        settings: newsletterSettingsSchema,
      }),
      z.object({
        action: z.literal('connect'),
        apiKey: z
          .string()
          .trim()
          .regex(/^re_[A-Za-z0-9_-]{10,200}$/),
      }),
      z.object({ action: z.literal('test') }),
      z.object({ action: z.literal('check') }),
      z.object({ action: z.literal('resume') }),
    ])
    .parse(input);
  if (parsed.action === 'connect') {
    const existingSegment = z
      .string()
      .nullish()
      .parse(await ctx.settings.get('segmentId'));
    // A dedicated segment prevents this blog from mailing other projects.
    if (existingSegment) {
      const segment = await provider(
        ctx,
        `/segments/${encodeURIComponent(existingSegment)}`,
        'GET',
        undefined,
        undefined,
        parsed.apiKey,
      );
      if (!segment)
        throw new Error(
          'This key cannot access the existing newsletter segment. Check the Resend team.',
        );
    } else {
      const segment = z.object({ id: z.string() }).parse(
        await provider(
          ctx,
          '/segments',
          'POST',
          {
            name: 'Japan journal confirmed subscribers',
          },
          undefined,
          parsed.apiKey,
        ),
      );
      await ctx.settings.set('segmentId', segment.id);
    }
    await ctx.settings.set('apiKey', parsed.apiKey);
    await ctx.cron?.schedule('digest', { schedule: '*/5 * * * *' });
  } else if (parsed.action === 'settings') {
    if (
      parsed.settings.enabled &&
      (!ownerEmail ||
        !(await ctx.settings.get('apiKey')) ||
        !(await ctx.settings.get('segmentId')))
    )
      throw new Error('Connect Resend before enabling automatic emails');
    await ctx.kv.set(settingsKey, parsed.settings);
    await ctx.kv.set('state', {
      ...z
        .record(z.string(), z.unknown())
        .parse((await ctx.kv.get('state')) ?? {}),
      nextSend: nextNewsletterSend(parsed.settings, Date.now()),
    });
    await ctx.cron?.schedule('digest', { schedule: '*/5 * * * *' });
  } else if (parsed.action === 'test') {
    if (!ownerEmail) throw new Error('Owner inbox is not configured');
    const posts = await pendingDigestPosts(ctx);
    if (!posts.length)
      throw new Error('Publish a journal entry before sending a test');
    const email = await digestEmail(posts, newsletterUrl, true);
    await provider(ctx, '/emails', 'POST', {
      from: newsletterFrom,
      to: [ownerEmail],
      reply_to: ownerEmail,
      subject: '[test] recent days in japan',
      ...email,
    });
  } else if (parsed.action === 'resume') await resumeNewsletterRun(ctx);
  else await checkNewsletterRun(ctx);
  return newsletterStatus(ctx);
}

export async function cleanupNewsletter(
  ctx: NewsletterContext,
  now = Date.now(),
) {
  for (const name of ['confirmations', 'limits']) {
    const collection = store(ctx, name);
    const page = await collection.query({
      where: { expiresAt: { lt: now } },
      limit: 100,
    });
    await collection.deleteMany(page.items.map((item) => item.id));
  }
  const subscribers = store(ctx, 'subscribers');
  const pending = await subscribers.query({
    where: { confirmed: false, requestedAt: { lt: now - 7 * 24 * hour } },
    limit: 100,
  });
  for (const item of pending.items) {
    const current = await subscribers.getVersioned(item.id);
    if (current) {
      const row = subscriberSchema.parse(current.value);
      if (!row.confirmed && row.requestedAt < now - 7 * 24 * hour)
        await subscribers.compareAndDelete(item.id, current.revision);
    }
  }
}
