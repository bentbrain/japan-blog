import type { IconEnvironment } from './category-icon-jobs';
import { categoryAssetRecord } from './category-icon-access';
import { categoryNames, iconHash } from './category-icons';
import { validateStoredCategoryIcon } from './category-icon-image';

export async function serveCategoryIcon(
  env: IconEnvironment,
  id: string,
  file: string,
  publishedNames: () => Promise<string[]>,
) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const missing = () => new Response('Not found', { status: 404, headers });
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}\.png$/.test(file))
    return missing();
  // Establish public membership before probing registry or storage. Even a
  // known hash for a private category follows the missing-category path.
  const published = await Promise.all(
    categoryNames(await publishedNames()).map(async (name) => ({
      normalized: name.normalized,
      id: await iconHash(name.normalized),
    })),
  );
  const category = published.find((name) => name.id === id);
  if (!category) return missing();
  const version = file.slice(0, -4);
  const record = await categoryAssetRecord(env.DB, id, version);
  const key = `category-icons/${id}/${version}.png`;
  if (
    !record ||
    record.normalized !== category.normalized ||
    record.ready_key !== key
  )
    return missing();
  const object = await env.MEDIA.get(key);
  if (
    !object ||
    object.size > 8192 ||
    object.httpMetadata?.contentType !== 'image/png'
  )
    return missing();
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (!(await validateStoredCategoryIcon(bytes))) return missing();
  return new Response(bytes, {
    headers: {
      ...headers,
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
    },
  });
}
