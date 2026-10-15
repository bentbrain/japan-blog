import type { ContentAccess, MediaAccess, PluginContext } from 'emdash';
import { z } from 'zod';
import { galleryIds, mediaSchema } from './model';
import {
  newsletterHash,
  newsletterPath,
  newsletterUrl,
  type DigestPost,
} from './newsletter-model';
import {
  shopDesignImage,
  shopDesignLink,
  shopDesignSchema,
} from './shop-design';
import type { NewsletterJpeg } from './newsletter-image';

type ContentItem = NonNullable<Awaited<ReturnType<ContentAccess['get']>>>;
export interface NewsletterAssetContext {
  content?: Pick<ContentAccess, 'get' | 'list'>;
  media?: Pick<MediaAccess, 'get' | 'readBytes'>;
  http?: PluginContext['http'];
}
interface ImageBucket {
  get(key: string): Promise<{
    size: number;
    customMetadata?: Record<string, string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  put(
    key: string,
    bytes: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<unknown>;
}
export interface NewsletterAssets {
  prepare(
    post: ContentItem,
  ): Promise<Pick<DigestPost, 'images' | 'shopDesign'>>;
  read(postId: string, key: string): Promise<Uint8Array | null>;
}
const prefix = 'newsletter-images/v1/';
const dimensionsSchema = z.object({
  width: z.coerce.number().int().min(1).max(1120),
  height: z.coerce.number().int().min(1).max(3360),
});
const publicPost = (post: ContentItem | null) =>
  Boolean(post && post.status === 'published' && post.slug && !post.data.demo);

function inlineAssets(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(inlineAssets);
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return [];
  if (parsed.data._type === 'image') {
    const asset = z
      .object({ _ref: z.string().optional(), id: z.string().optional() })
      .safeParse(parsed.data.asset);
    return asset.success ? [asset.data._ref || asset.data.id || ''] : [];
  }
  return Object.values(parsed.data).flatMap(inlineAssets);
}

async function publishedMedia(ctx: NewsletterAssetContext) {
  if (!ctx.content) throw new Error('Newsletter content unavailable');
  const items = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.content.list('media_items', {
      where: { status: 'published' },
      limit: 100,
      cursor,
    });
    for (const item of page.items) {
      if (item.status !== 'published' || item.data.demo) continue;
      const parsed = mediaSchema.safeParse({
        ...item.data,
        id: item.id,
        slug: item.slug,
      });
      items.push({ item, data: parsed.success ? parsed.data : null });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return items;
}

async function photoSources(ctx: NewsletterAssetContext, post: ContentItem) {
  const media = await publishedMedia(ctx);
  const selected = [
    ...inlineAssets(post.data.content).flatMap((id) =>
      media.filter((m) => {
        const asset = z
          .object({ asset: z.object({ id: z.string() }) })
          .safeParse(m.item.data);
        return (
          m.item.data.kind === 'photo' &&
          asset.success &&
          asset.data.asset.id === id
        );
      }),
    ),
    ...galleryIds(post.data.gallery).flatMap((id) =>
      media.filter((m) => m.item.id === id),
    ),
  ];
  return selected
    .filter(
      (item, index) =>
        selected.findIndex((m) => m.item.id === item.item.id) === index,
    )
    .map((source) => {
      if (!source.data) throw new Error('Published image metadata unavailable');
      return { item: source.item, data: source.data };
    });
}

async function photoVersion(
  source: Awaited<ReturnType<typeof photoSources>>[number],
) {
  return newsletterHash(
    JSON.stringify({
      id: source.item.id,
      asset:
        source.data.kind === 'video'
          ? source.data.poster?.id
          : source.data.asset?.id,
      kind: source.data.kind,
    }),
  );
}

async function shopBytes(ctx: NewsletterAssetContext, value: unknown) {
  const design = shopDesignSchema.parse(value);
  if (!ctx.http) throw new Error('Newsletter shop transport unavailable');
  const response = await ctx.http.fetch(shopDesignImage(design), {
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  if (
    !response.ok ||
    !response.headers.get('Content-Type')?.startsWith('image/')
  )
    throw new Error('Published shirt image is unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new Error('Shirt image exceeds the email input limit');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const contentHash = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return {
    design,
    bytes,
    version: await newsletterHash(shopDesignLink(design) + contentHash),
  };
}

export function createNewsletterAssets(
  ctx: NewsletterAssetContext,
  bucket: ImageBucket,
  optimise: (source: Uint8Array) => Promise<NewsletterJpeg>,
  origin = newsletterUrl,
): NewsletterAssets {
  async function prepareImage(
    post: ContentItem,
    kind: 'photo' | 'shirt',
    sourceId: string,
    version: string,
    alt: string,
    load: () => Promise<Uint8Array>,
  ) {
    const key = await newsletterHash(
      JSON.stringify({ postId: post.id, kind, sourceId, version }),
    );
    const path = `${prefix}${key}.jpg`;
    const existing = await bucket.get(path);
    let dimensions = dimensionsSchema.safeParse(existing?.customMetadata);
    if (!existing || existing.size > 150_000 || !dimensions.success) {
      const image = await optimise(await load());
      if (image.bytes.length > 150_000)
        throw new Error('Newsletter image exceeds the email size limit');
      dimensions = dimensionsSchema.safeParse(image);
      if (!dimensions.success)
        throw new Error('Newsletter image dimensions are invalid');
      await bucket.put(path, Uint8Array.from(image.bytes).buffer, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          postId: post.id,
          kind,
          sourceId,
          version,
          width: String(image.width),
          height: String(image.height),
        },
      });
    }
    return {
      src: `${origin}${newsletterPath}/image?post=${encodeURIComponent(post.id)}&key=${key}`,
      alt,
      ...dimensions.data,
    };
  }
  return {
    async prepare(post) {
      if (!publicPost(post))
        throw new Error('Published journal entry required');
      const images = [];
      for (const source of await photoSources(ctx, post)) {
        const assetId =
          source.data.kind === 'video'
            ? source.data.poster?.id
            : source.data.asset?.id;
        if (!assetId) throw new Error('Published image asset unavailable');
        const asset = await ctx.media?.get(assetId);
        if (!asset?.mimeType.startsWith('image/'))
          throw new Error('Published image asset unavailable');
        images.push(
          await prepareImage(
            post,
            'photo',
            source.item.id,
            await photoVersion(source),
            source.data.title,
            async () => {
              if (!ctx.media?.readBytes)
                throw new Error('Newsletter media transport unavailable');
              return (
                await ctx.media.readBytes(assetId, {
                  maxBytes: 16 * 1024 * 1024,
                })
              ).bytes;
            },
          ),
        );
      }
      const parsed = shopDesignSchema.safeParse(post.data.shop_design);
      if (post.data.shop_design && !parsed.success)
        throw new Error('Published shirt design is invalid');
      if (!parsed.success) return { images };
      const shirt = await shopBytes(ctx, parsed.data);
      const image = await prepareImage(
        post,
        'shirt',
        'shirt',
        shirt.version,
        `Flat ${shirt.design.color} t-shirt with this journal design`,
        () => Promise.resolve(shirt.bytes),
      );
      return { images, shopDesign: { ...shirt.design, image } };
    },
    async read(postId, key) {
      if (!/^[a-f0-9]{64}$/.test(key) || !ctx.content) return null;
      const post = await ctx.content.get('posts', postId);
      if (!post || !publicPost(post)) return null;
      const object = await bucket.get(`${prefix}${key}.jpg`);
      const meta = object?.customMetadata;
      if (!object || !meta || meta.postId !== post.id || object.size > 150_000)
        return null;
      if (meta.kind === 'photo') {
        const source = (await photoSources(ctx, post)).find(
          (m) => m.item.id === meta.sourceId,
        );
        if (!source || (await photoVersion(source)) !== meta.version)
          return null;
        const assetId =
          source.data.kind === 'video'
            ? source.data.poster?.id
            : source.data.asset?.id;
        if (!assetId) return null;
        const asset = await ctx.media?.get(assetId);
        if (!asset?.mimeType.startsWith('image/')) return null;
      } else if (meta.kind === 'shirt') {
        if (
          !post.data.shop_design ||
          (await shopBytes(ctx, post.data.shop_design)).version !== meta.version
        )
          return null;
      } else return null;
      return new Uint8Array(await object.arrayBuffer());
    },
  };
}
