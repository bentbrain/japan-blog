import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { categoryNames } from './category-icons';

// Owner status uses the latest saved draft, including staged changes to a
// currently published item. Public routes use the published trip loader.
export async function visibleCategoryNames(emdash: App.Locals['emdash']) {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await emdash.handleContentList('media_items', {
      limit: 100,
      cursor,
    });
    if (!result.success) throw new Error('Could not read categories');
    const page = z
      .object({
        items: z.array(
          z.object({
            id: z.string(),
            slug: z.string().nullable(),
            data: z.record(z.string(), z.unknown()),
            liveData: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
        nextCursor: z.string().nullish(),
      })
      .parse(result.data);
    for (const item of page.items) {
      const current = await emdash.handleContentGet('media_items', item.id);
      if (!current.success || !current.data) continue;
      const data = z
        .record(z.string(), z.unknown())
        .parse(current.data.item.data);
      names.push(...categoryNames(data.categories).map((name) => name.label));
    }
    cursor = page.nextCursor || undefined;
  } while (cursor);
  return names;
}

export async function categoryAssetRecord(
  db: D1Database,
  id: string,
  version: string,
) {
  return db
    .prepare(
      'SELECT normalized,ready_key FROM jp_categories WHERE id=? AND ready_version=? AND ready_key IS NOT NULL',
    )
    .bind(id, version)
    .first<{ normalized: string; ready_key: string }>();
}

// Bypass content-query caches for revocation checks. Draft revisions never
// overwrite these live columns. No private rows or icon records enter this set.
export async function currentPublishedCategoryNames(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT DISTINCT j.value AS label FROM ec_media_items m, json_each(CASE WHEN json_valid(m.categories) THEN m.categories ELSE '[]' END) j WHERE m.status='published' AND m.deleted_at IS NULL AND j.type='text'`,
    )
    .all<{ label: string }>();
  return categoryNames(rows.results.map((row) => row.label));
}
