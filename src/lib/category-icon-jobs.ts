import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import {
  categoryNames,
  iconHash,
  iconModel,
  iconPromptVersion,
  isDefaultCategory,
  supportedIconModels,
} from './category-icons';
import {
  generateCategoryIcon,
  validateStoredCategoryIcon,
} from './category-icon-image';
import type { CategoryIconStatus } from './category-icons';

export interface IconEnvironment {
  DB: D1Database;
  MEDIA: R2Bucket;
  OPENAI_API_KEY?: string;
  CATEGORY_ICON_MODEL?: string;
}
interface CategoryRow {
  id: string;
  normalized: string;
  label: string;
  generation: number;
  ready_key: string | null;
  ready_version: string | null;
}
interface JobRow {
  id: string;
  category_id: string;
  model: string;
  version: string;
  generation: number;
  status: string;
  attempts: number;
  lease_token: string | null;
}
const configured = (env: IconEnvironment) =>
  Boolean(env.OPENAI_API_KEY?.trim()) &&
  supportedIconModels.includes(env.CATEGORY_ICON_MODEL || '');

// Each insert pair and its outbox acknowledgement commit together. Concurrent
// drains share the same hashes and conflict keys, so none can create duplicates.
export async function drainIconOutbox(env: IconEnvironment, now = Date.now()) {
  const baseline = await env.DB.prepare(
    'SELECT label FROM jp_icon_baseline LIMIT 100',
  ).all<{ label: string }>();
  for (const { label } of baseline.results) {
    const names = categoryNames([label]);
    const statements = [];
    for (const name of names)
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO jp_categories(id,normalized,label) VALUES(?,?,?)',
        ).bind(await iconHash(name.normalized), name.normalized, name.label),
      );
    statements.push(
      env.DB.prepare('DELETE FROM jp_icon_baseline WHERE label = ?').bind(
        label,
      ),
    );
    await env.DB.batch(statements);
  }
  // Finish seeding before admitting new categories, even for a large library.
  if (
    await env.DB.prepare('SELECT label FROM jp_icon_baseline LIMIT 1').first()
  )
    return;
  const events = await env.DB.prepare(
    'SELECT id,categories FROM jp_icon_outbox ORDER BY id LIMIT 50',
  ).all<{ id: number; categories: string }>();
  for (const event of events.results) {
    let value: unknown;
    try {
      value = JSON.parse(event.categories);
    } catch {
      value = [];
    }
    const statements = [];
    for (const name of categoryNames(value)) {
      const id = await iconHash(name.normalized);
      // Defaults never spend. The initial generation update below only applies
      // to a newly inserted row, using changes() in this transactional batch.
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO jp_categories(id,normalized,label,generation) VALUES(?,?,?,?)',
        ).bind(
          id,
          name.normalized,
          name.label,
          isDefaultCategory(name.normalized) ? 0 : 1,
        ),
      );
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO jp_icon_jobs(id,category_id,version,model,generation,status,available_at,created_at) SELECT ?,?,?,?,1,'pending',?,? WHERE changes() = 1 AND ? = 0`,
        ).bind(
          `${id}:1`,
          id,
          iconPromptVersion,
          env.CATEGORY_ICON_MODEL || iconModel,
          now,
          now,
          isDefaultCategory(name.normalized) ? 1 : 0,
        ),
      );
    }
    statements.push(
      env.DB.prepare('DELETE FROM jp_icon_outbox WHERE id = ?').bind(event.id),
    );
    await env.DB.batch(statements);
  }
}

export async function claimIconJob(env: IconEnvironment, now = Date.now()) {
  // A crashed request may already have incurred a charge. Never replay it.
  await env.DB.prepare(
    `UPDATE jp_icon_jobs SET status='uncertain', lease_token=NULL, lease_until=NULL WHERE status='running' AND lease_until <= ?`,
  )
    .bind(now)
    .run();
  if (!configured(env)) return null;
  const blocked = await env.DB.prepare(
    'SELECT provider_blocked FROM jp_icon_settings WHERE id=1',
  ).first<{ provider_blocked: number }>();
  if (blocked?.provider_blocked) return null;
  const token = crypto.randomUUID();
  const result = await env.DB.batch<JobRow>([
    env.DB.prepare(
      `UPDATE jp_icon_jobs SET status='running', attempts=attempts+1, lease_token=?, lease_until=? WHERE id=(SELECT id FROM jp_icon_jobs WHERE status='pending' AND available_at<=? AND attempts<3 ORDER BY available_at,created_at,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM jp_icon_jobs WHERE status='running') AND (SELECT COUNT(*) FROM jp_icon_attempts WHERE started_at>?)<5 RETURNING *`,
    ).bind(token, now + 180_000, now, now - 86_400_000),
    env.DB.prepare(
      `INSERT INTO jp_icon_attempts(token,job_id,started_at) SELECT ?,id,? FROM jp_icon_jobs WHERE lease_token=? AND status='running'`,
    ).bind(token, now, token),
  ]);
  return result[0]?.results[0] || null;
}

export async function runCategoryIconJobs(
  env: IconEnvironment,
  deps: { now?: () => number; generate?: typeof generateCategoryIcon } = {},
) {
  const now = deps.now || Date.now;
  await drainIconOutbox(env, now());
  const job = await claimIconJob(env, now());
  if (!job) return;
  const category = await env.DB.prepare(
    'SELECT * FROM jp_categories WHERE id=?',
  )
    .bind(job.category_id)
    .first<CategoryRow>();
  if (!category || !env.OPENAI_API_KEY) return;
  let outcome;
  try {
    outcome = await (deps.generate || generateCategoryIcon)({
      key: env.OPENAI_API_KEY,
      model: job.model,
      category: { normalized: category.normalized, label: category.label },
    });
  } catch {
    // Includes local storage/processing failures after a dispatched request.
    outcome = { status: 'uncertain' };
  }
  const token = job.lease_token;
  if (
    outcome.status === 'ready' &&
    'bytes' in outcome &&
    outcome.bytes instanceof Uint8Array &&
    (await validateStoredCategoryIcon(outcome.bytes))
  ) {
    const version = await iconHash(
      `${job.version}\n${job.model}\n${String(job.generation)}\n${await iconHash(String(outcome.bytes))}`,
    );
    const key = `category-icons/${category.id}/${version}.png`;
    try {
      await env.MEDIA.put(key, outcome.bytes, {
        httpMetadata: {
          contentType: 'image/png',
          cacheControl: 'private, no-store',
        },
      });
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE jp_categories SET ready_key=?,ready_version=? WHERE id=? AND EXISTS(SELECT 1 FROM jp_icon_jobs WHERE id=? AND status='running' AND lease_token=?)`,
        ).bind(key, version, category.id, job.id, token),
        env.DB.prepare(
          `UPDATE jp_icon_jobs SET status='ready',lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?`,
        ).bind(job.id, token),
      ]);
      return;
    } catch {
      /* Do not re-generate after a storage failure. */
    }
  }
  const status =
    outcome.status === 'rate_limited' && job.attempts < 3
      ? 'pending'
      : outcome.status === 'blocked_configuration'
        ? 'configuration'
        : outcome.status === 'failed' || outcome.status === 'rate_limited'
          ? 'failed'
          : 'uncertain';
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jp_icon_jobs SET status=?,available_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?`,
    ).bind(
      status,
      now() + Math.min(3600_000, 60_000 * 2 ** job.attempts),
      job.id,
      token,
    ),
    env.DB.prepare(
      'UPDATE jp_icon_settings SET provider_blocked=CASE WHEN ?=1 THEN 1 ELSE provider_blocked END WHERE id=1',
    ).bind(status === 'configuration' ? 1 : 0),
  ]);
}

export async function ownerIconStatuses(
  env: IconEnvironment,
  names: string[],
): Promise<CategoryIconStatus[]> {
  const blocked = await env.DB.prepare(
    'SELECT provider_blocked FROM jp_icon_settings WHERE id=1',
  ).first<{ provider_blocked: number }>();
  const requested = categoryNames(names);
  const rows = new Map<
    string,
    { generation: number; ready_key: string | null; status: string | null }
  >();
  for (let offset = 0; offset < requested.length; offset += 90) {
    const chunk = requested.slice(offset, offset + 90);
    const result = await env.DB.prepare(
      `SELECT c.normalized,c.generation,c.ready_key,j.status FROM jp_categories c LEFT JOIN jp_icon_jobs j ON j.category_id=c.id AND j.generation=c.generation WHERE c.normalized IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk.map((name) => name.normalized))
      .all<{
        normalized: string;
        generation: number;
        ready_key: string | null;
        status: string | null;
      }>();
    for (const row of result.results) rows.set(row.normalized, row);
  }
  return requested.map((name): CategoryIconStatus => {
    const category = rows.get(name.normalized);
    const job = category?.status ? { status: category.status } : null;
    const state = isDefaultCategory(name.normalized)
      ? 'default'
      : !configured(env)
        ? 'setup'
        : blocked?.provider_blocked
          ? 'configuration'
          : job?.status === 'uncertain'
            ? 'uncertain'
            : job?.status === 'failed'
              ? 'failed'
              : job?.status === 'configuration'
                ? 'configuration'
                : job?.status === 'pending' || job?.status === 'running'
                  ? 'pending'
                  : category?.ready_key
                    ? 'ready'
                    : category
                      ? 'default'
                      : 'pending';
    return {
      ...name,
      state,
      canRetry:
        Boolean(category) &&
        configured(env) &&
        !isDefaultCategory(name.normalized) &&
        (category?.generation || 0) < 3 &&
        !['pending', 'running'].includes(job?.status || ''),
    };
  });
}

export async function retryCategoryIcon(
  env: IconEnvironment,
  name: string,
  acknowledgeCharge: boolean,
  now = Date.now(),
) {
  const normalized = categoryNames([name])[0]?.normalized;
  if (!normalized || isDefaultCategory(normalized) || !configured(env))
    return false;
  // Explicit owner retry is the only operation that clears a provider failure.
  const result = await env.DB.batch<CategoryRow>([
    env.DB.prepare(
      `UPDATE jp_categories SET generation=generation+1 WHERE normalized=? AND generation<3 AND NOT EXISTS(SELECT 1 FROM jp_icon_jobs WHERE category_id=jp_categories.id AND status IN ('pending','running')) AND (?=1 OR NOT EXISTS(SELECT 1 FROM jp_icon_jobs WHERE category_id=jp_categories.id AND status='uncertain')) RETURNING *`,
    ).bind(normalized, acknowledgeCharge ? 1 : 0),
    env.DB.prepare(
      `INSERT INTO jp_icon_jobs(id,category_id,version,model,generation,status,available_at,created_at) SELECT id || ':' || generation,id,?,?,generation,'pending',?,? FROM jp_categories WHERE normalized=? AND changes()=1`,
    ).bind(iconPromptVersion, env.CATEGORY_ICON_MODEL, now, now, normalized),
    env.DB.prepare(
      'UPDATE jp_icon_settings SET provider_blocked=0 WHERE id=1 AND changes()=1',
    ),
  ]);
  return Boolean(result[0]?.results[0]);
}

export async function readyCategoryIcons(
  env: IconEnvironment,
  names: string[],
) {
  const icons = new Map<string, string>();
  const requested = categoryNames(names);
  for (let offset = 0; offset < requested.length; offset += 90) {
    const chunk = requested.slice(offset, offset + 90);
    const result = await env.DB.prepare(
      `SELECT id,normalized,ready_version FROM jp_categories WHERE normalized IN (${chunk.map(() => '?').join(',')}) AND ready_key IS NOT NULL`,
    )
      .bind(...chunk.map((name) => name.normalized))
      .all<{ id: string; normalized: string; ready_version: string }>();
    for (const row of result.results)
      icons.set(
        row.normalized,
        `/category-icons/${row.id}/${row.ready_version}.png`,
      );
  }
  return icons;
}
