import { ContentSaveRejectedError, definePlugin } from 'emdash';
import { daySchema, metadataSchema } from '../lib/model';
import { z } from 'zod';

export function embeddedMediaReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(embeddedMediaReferences);
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return [];
  const block = parsed.data;
  if (block._type === 'image' || block._type === 'video') {
    const asset = z.object({ _ref: z.string().min(1) }).safeParse(block.asset);
    return [asset.success ? asset.data._ref : ''];
  }
  return Object.values(block).flatMap(embeddedMediaReferences);
}

export function validateMedia(
  content: Record<string, unknown>,
): string | undefined {
  const data = metadataSchema.safeParse(content);
  if (!data.success)
    return 'Add capture time and valid coordinates before publishing.';
  if (
    content.kind === 'video' &&
    (typeof content.duration !== 'number' ||
      content.duration <= 0 ||
      content.duration > 10.1)
  )
    return 'Videos must be 10 seconds or shorter.';
  if (
    content.demo !== true &&
    content.demo !== 1 &&
    (!content.asset || typeof content.asset !== 'object')
  )
    return 'Upload a media file before publishing.';
}
export function createPlugin() {
  return definePlugin({
    id: 'japan-trip',
    version: '1.0.0',
    capabilities: [
      'content:read',
      'content:write',
      'hooks.content-policy:register',
    ],
    hooks: {
      'content:beforeSave': (event) => {
        if (
          event.collection === 'posts' &&
          !daySchema.safeParse(event.content.day).success
        )
          throw new ContentSaveRejectedError('Choose a valid post day.');
        if (
          event.collection === 'beers' &&
          (!daySchema.safeParse(event.content.day).success ||
            !z.number().int().min(0).max(100).safeParse(event.content.count)
              .success)
        )
          throw new ContentSaveRejectedError(
            'Choose a day and a beer count between 0 and 100.',
          );
        return Promise.resolve();
      },
      'content:beforePublish': async (event, ctx) => {
        const content = z
          .record(z.string(), z.unknown())
          .parse(event.content.data);
        if (event.collection === 'media_items') {
          const reason = validateMedia(content);
          if (reason) return { cancel: true, reason };
        }
        if (event.collection === 'posts') {
          const gallery = z.array(z.string()).safeParse(content.gallery ?? []);
          if (!gallery.success)
            return {
              cancel: true,
              reason: 'Choose media from the trip library.',
            };
          for (const id of gallery.data) {
            const item = await ctx.content?.get('media_items', id);
            if (
              !item ||
              item.status !== 'published' ||
              validateMedia(item.data)
            )
              return {
                cancel: true,
                reason:
                  'Publish every selected media item with its location first.',
              };
          }
          const embedded = embeddedMediaReferences(content.content);
          if (embedded.length) {
            const located = new Set<string>();
            let cursor: string | undefined;
            do {
              const page = await ctx.content?.list('media_items', {
                limit: 100,
                cursor,
              });
              for (const item of page?.items ?? []) {
                if (item.status !== 'published' || validateMedia(item.data))
                  continue;
                const asset = z
                  .object({ id: z.string() })
                  .safeParse(item.data.asset);
                if (asset.success) located.add(asset.data.id);
              }
              cursor = page?.hasMore ? page.cursor : undefined;
            } while (cursor);
            if (embedded.some((id) => !located.has(id)))
              return {
                cancel: true,
                reason:
                  'Add inline photos and videos to the trip library with their location before publishing.',
              };
          }
        }
      },
    },
  });
}
