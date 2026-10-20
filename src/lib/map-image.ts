import type { D1Database } from '@cloudflare/workers-types';
import {
  displayPreviewKey,
  displayPreviewReference,
  previewPath,
  responsiveImage,
} from './responsive-image';

interface HeaderBucket {
  get(
    key: string,
    options: { range: { offset: number; length: number } },
  ): Promise<{
    httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
}

// Prepared display JPEGs have their frame header before the compressed scan.
// Read only a bounded prefix, never an original or a browser metadata request.
export function jpegDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9) return;
    const length = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) return;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      if (length < 8) return;
      const height = (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0);
      const width = (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0);
      return width && height ? { width, height } : undefined;
    }
    offset += length;
  }
}

export async function mapImage(
  id: string,
  source: string,
  env: { DB: D1Database; MEDIA: HeaderBucket },
) {
  const horizontal = '(min-width: 672px) 614px, calc(100vw - 58px)';
  const fallback = responsiveImage(source, horizontal);
  const reference = displayPreviewReference(source);
  if (!reference) return fallback;
  const match = previewPath.exec(`/media-preview/${reference}/320/auto`);
  if (!match) return fallback;
  const [, , asset, folder, filename] = match;
  const key = asset || `trip/${folder || ''}/${filename || ''}.jpg`;
  try {
    const live = () =>
      env.DB.prepare(
        `SELECT a.storage_key, a.width, a.height FROM media a
         JOIN ec_media_items m ON a.id=json_extract(CASE WHEN json_valid(m.asset) THEN m.asset END,'$.id')
           OR a.id=json_extract(CASE WHEN json_valid(m.poster) THEN m.poster END,'$.id')
         WHERE m.id=? AND m.kind='photo' AND m.status='published'
           AND m.deleted_at IS NULL AND a.mime_type='image/jpeg'
           AND a.${asset ? 'id' : 'storage_key'}=? LIMIT 1`,
      )
        .bind(id, key)
        .first<{
          storage_key: string;
          width: number | null;
          height: number | null;
        }>();
    const current = await live();
    if (!current || !displayPreviewKey.test(current.storage_key))
      return fallback;
    let dimensions =
      Number.isSafeInteger(current.width) &&
      Number.isSafeInteger(current.height) &&
      current.width !== null &&
      current.height !== null &&
      current.width > 0 &&
      current.height > 0
        ? { width: current.width, height: current.height }
        : undefined;
    if (!dimensions) {
      const header = await env.MEDIA.get(current.storage_key, {
        range: { offset: 0, length: 65536 },
      });
      if (!header) return fallback;
      const bytes = new Uint8Array(await header.arrayBuffer());
      if (header.httpMetadata?.contentType !== 'image/jpeg') return fallback;
      dimensions = jpegDimensions(bytes);
      if ((await live())?.storage_key !== current.storage_key) return fallback;
    }
    if (!dimensions) return fallback;
    const heightWidth = `${String((55 * dimensions.width) / dimensions.height)}dvh`;
    return responsiveImage(
      source,
      `(min-width: 672px) min(614px, ${heightWidth}), min(calc(100vw - 58px), ${heightWidth})`,
      Math.min(
        dimensions.width,
        Math.max(1, Math.round((1600 * dimensions.width) / dimensions.height)),
      ),
    );
  } catch {
    // A missing header must not hide a photo or break the map controls.
    return fallback;
  }
}
