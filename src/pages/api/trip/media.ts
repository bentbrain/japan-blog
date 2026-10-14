import type { APIRoute } from 'astro';
import { z } from 'zod';
import { metadataSchema } from '../../../lib/model';

export const GET: APIRoute = async ({ locals }) => {
  const ids: { id: string }[] = [];
  let cursor: string | undefined;
  do {
    const result = await locals.emdash.handleContentList('media_items', {
      limit: 100,
      orderBy: 'createdAt',
      order: 'desc',
      cursor,
    });
    if (!result.success) return Response.json(result, { status: 500 });
    const page = z
      .object({
        items: z.array(z.object({ id: z.string() })),
        nextCursor: z.string().nullish(),
      })
      .parse(result.data);
    ids.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const items = [];
  for (const { id } of ids) {
    const entry = await locals.emdash.handleContentGet('media_items', id);
    if (entry.success && entry.data) {
      const data = z
        .record(z.string(), z.unknown())
        .parse(entry.data.item.data);
      for (const field of ['asset', 'poster']) {
        const reference = z.object({ id: z.string() }).safeParse(data[field]);
        if (!reference.success) continue;
        const stored = await locals.emdash.handleMediaGet(reference.data.id);
        if (!stored.success) continue;
        const media = z
          .object({
            item: z.object({ filename: z.string(), storageKey: z.string() }),
          })
          .parse(stored.data);
        const url = `/_emdash/api/media/asset/${encodeURIComponent(reference.data.id)}/${encodeURIComponent(media.item.filename)}`;
        data[field] = { ...reference.data, url, src: url };
        data[field === 'asset' ? 'source_url' : 'poster_url'] =
          `/_emdash/api/media/file/${media.item.storageKey}`;
      }
      items.push({ ...entry.data.item, data, _rev: entry.data._rev });
    }
  }
  return Response.json({ items });
};
export const PATCH: APIRoute = async ({ request, locals }) => {
  const parsed = z
    .object({
      id: z.string(),
      revision: z.string(),
      publish: z.boolean(),
      metadata: metadataSchema,
    })
    .safeParse(await request.json());
  if (!parsed.success || !locals.user)
    return Response.json(
      { error: 'Add a capture time and coordinates' },
      { status: 400 },
    );
  const { id, revision, publish, metadata } = parsed.data,
    actor = { id: locals.user.id, role: locals.user.role };
  const saved = await locals.emdash.handleContentUpdate('media_items', id, {
    data: { ...metadata, captured_at: metadata.captured_at.toISOString() },
    _rev: revision,
    actor,
  });
  if (!saved.success) return Response.json(saved, { status: 409 });
  const current = await locals.emdash.handleContentGet('media_items', id);
  if (!current.success || !current.data)
    return Response.json(current, { status: 500 });
  const result = publish
    ? await locals.emdash.handleContentPublish('media_items', id, {
        _rev: current.data._rev,
        actor,
        origin: { source: 'api' },
      })
    : current.data.item.status === 'published'
      ? await locals.emdash.handleContentUnpublish('media_items', id, {
          _rev: current.data._rev,
          actor,
          origin: { source: 'api' },
        })
      : current;
  return Response.json(result, { status: result.success ? 200 : 422 });
};
