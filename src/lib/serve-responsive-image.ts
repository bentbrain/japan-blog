import type { D1Database } from '@cloudflare/workers-types';
import { displayPreviewKey, previewPath } from './responsive-image';

// Matches the documented Images binding API using the app's DOM Web Streams.
// The Workers package declares a different ReadableStream type at this boundary.
export interface DisplayImagesBinding {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width: number; height: number; fit: 'scale-down' }): {
      output(options: {
        format: 'image/jpeg' | 'image/webp';
        quality: number;
        anim: boolean;
      }): Promise<{ response(): Response }>;
    };
  };
}
interface ByteStream {
  cancel(): Promise<void>;
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
}
function webStream(source: ByteStream) {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          reader.releaseLock();
        } else if (chunk.value) controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      reader.releaseLock();
    },
  });
}
interface PreviewBucket {
  get(key: string): Promise<{
    body: ByteStream;
    size: number;
    httpMetadata?: { contentType?: string };
  } | null>;
}
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Accept',
};
export function imageUnavailable(status = 404) {
  return new Response(status === 404 ? 'Not found' : 'Image unavailable', {
    status,
    headers: privateHeaders,
  });
}
export async function serveResponsiveImage(
  request: Request,
  path: string,
  env: { DB: D1Database; MEDIA: PreviewBucket; IMAGES: DisplayImagesBinding },
  privateRender: boolean,
) {
  const match = previewPath.exec(path);
  // Never use owner privileges or preview tokens to bypass live membership.
  if (
    !match ||
    privateRender ||
    !['GET', 'HEAD'].includes(request.method) ||
    new URL(request.url).search
  )
    return imageUnavailable();
  const [, , id, folder, filename, width, output] = match;
  if (!id && (!folder || !filename)) return imageUnavailable();
  const key = id || `trip/${folder || ''}/${filename || ''}.jpg`;
  try {
    const livePreview = () =>
      env.DB.prepare(
        `
      SELECT a.storage_key FROM media a JOIN ec_media_items m ON
        (m.kind='photo' AND a.id=json_extract(CASE WHEN json_valid(m.asset) THEN m.asset END,'$.id')) OR
        (m.kind='video' AND a.id=json_extract(CASE WHEN json_valid(m.poster) THEN m.poster END,'$.id'))
      WHERE a.${id ? 'id' : 'storage_key'}=? AND a.mime_type='image/jpeg'
        AND m.status='published' AND m.deleted_at IS NULL LIMIT 1
    `,
      )
        .bind(key)
        .first<{ storage_key: string }>();
    const current = await livePreview();
    if (!current || !displayPreviewKey.test(current.storage_key))
      return imageUnavailable();
    const source = await env.MEDIA.get(current.storage_key);
    if (!source) return imageUnavailable();
    if (source.size <= 0 || source.httpMetadata?.contentType !== 'image/jpeg') {
      await source.body.cancel();
      return imageUnavailable(422);
    }
    if (request.method === 'HEAD') {
      await source.body.cancel();
      return new Response(null, { headers: privateHeaders });
    }
    // Native uploads permit larger display previews than the bounded transform
    // input. Preserve their availability by streaming the existing live preview.
    if (source.size > 16 * 1024 * 1024) {
      const live = await livePreview();
      if (live?.storage_key !== current.storage_key) {
        await source.body.cancel();
        return imageUnavailable();
      }
      return new Response(webStream(source.body), {
        headers: { ...privateHeaders, 'Content-Type': 'image/jpeg' },
      });
    }
    const acceptsWebp = (request.headers.get('Accept') || '')
      .split(',')
      .some((value) => {
        const [type, ...parameters] = value.trim().split(';');
        return (
          type === 'image/webp' &&
          !parameters.some((parameter) =>
            /^\s*q=0(?:\.0*)?\s*$/.test(parameter),
          )
        );
      });
    const format =
      output === 'webp' || (output === 'auto' && acceptsWebp)
        ? 'image/webp'
        : 'image/jpeg';
    try {
      const result = await env.IMAGES.input(webStream(source.body))
        .transform({ width: Number(width), height: 1600, fit: 'scale-down' })
        .output({ format, quality: 75, anim: false });
      const transformed = result.response();
      if (
        !transformed.ok ||
        !transformed.body ||
        transformed.headers.get('Content-Type') !== format
      )
        throw new Error('Image transform failed');
      const live = await livePreview();
      if (live?.storage_key !== current.storage_key) {
        await transformed.body.cancel();
        return imageUnavailable();
      }
      return new Response(transformed.body, {
        headers: { ...privateHeaders, 'Content-Type': format },
      });
    } catch {
      // Recheck membership before falling back, so an unpublish during a failed
      // transform cannot expose a now-private preview. No stored derivatives.
      const live = await livePreview();
      if (live?.storage_key !== current.storage_key) return imageUnavailable();
      const fallback = await env.MEDIA.get(current.storage_key);
      if (!fallback) return imageUnavailable();
      if (
        fallback.size <= 0 ||
        fallback.httpMetadata?.contentType !== 'image/jpeg'
      ) {
        await fallback.body.cancel();
        return imageUnavailable(422);
      }
      return new Response(webStream(fallback.body), {
        headers: { ...privateHeaders, 'Content-Type': 'image/jpeg' },
      });
    }
  } catch {
    return imageUnavailable(503);
  }
}
