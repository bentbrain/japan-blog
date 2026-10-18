import type { D1Database } from '@cloudflare/workers-types';

// Check live columns directly, without hydrating or paging the whole library
// for every image request. Draft revisions never overwrite published columns.
export async function publishedMediaAccess(
  db: D1Database,
  kind: 'asset' | 'file',
  key: string,
) {
  const column = kind === 'asset' ? 'id' : 'storage_key';
  const found = await db
    .prepare(
      `
    SELECT 1 AS allowed FROM media a
    JOIN ec_media_items m ON
      a.id=json_extract(CASE WHEN json_valid(m.asset) THEN m.asset END,'$.id') OR
      a.id=json_extract(CASE WHEN json_valid(m.poster) THEN m.poster END,'$.id')
    WHERE a.${column}=? AND m.status='published' AND m.deleted_at IS NULL LIMIT 1
  `,
    )
    .bind(key)
    .first<{ allowed: number }>();
  return found?.allowed === 1;
}
