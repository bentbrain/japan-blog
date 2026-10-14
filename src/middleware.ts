import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { z } from 'zod';

export const onRequest = defineMiddleware(async (context, next) => {
  let path = context.url.pathname;
  for (let depth = 0; depth < 4 && path.includes('%'); depth++) {
    try {
      path = decodeURIComponent(path);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
  if (path.includes('%')) return new Response('Not found', { status: 404 });
  if (!import.meta.env.DEV) {
    if (path === '/owner/setup') {
      const key = context.url.searchParams.get('key');
      if (!key || !env.SETUP_TOKEN || key !== env.SETUP_TOKEN)
        return new Response('Not found', { status: 404 });
      context.cookies.set('jp_setup', key, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 900,
      });
      return context.redirect('/_emdash/admin/setup');
    }
    if (
      (path.startsWith('/_emdash/api/setup') ||
        path.startsWith('/_emdash/admin/setup')) &&
      (!env.SETUP_TOKEN ||
        context.cookies.get('jp_setup')?.value !== env.SETUP_TOKEN)
    )
      return new Response('Not found', { status: 404 });
    if (context.locals.user && context.locals.user.email !== env.OWNER_EMAIL)
      return new Response('Owner account required', { status: 403 });
  }
  // Uploaded previews are already resized; refuse the transform endpoint so it
  // cannot read private storage directly or cache unpublished derivatives.
  if (path === '/_image') return new Response('Not found', { status: 404 });
  if (path.startsWith('/_emdash/api/media/file/trip-private/'))
    return new Response('Not found', { status: 404 });
  const mediaFile = /^\/_emdash\/api\/media\/(file|asset)\/(.+)$/.exec(path);
  if (mediaFile) {
    context.cache.set(false);
    const owner = context.locals.user && context.locals.user.role >= 50;
    if (!owner) {
      const key = mediaFile[2] || '';
      const assetId = mediaFile[1] === 'asset' ? key.split('/')[0] : undefined;
      const tripSlug =
        mediaFile[1] === 'file' && key.startsWith('trip/')
          ? key.split('/')[1]
          : undefined;
      let allowed = false;
      let cursor: string | undefined;
      do {
        const result = await context.locals.emdash.handleContentList(
          'media_items',
          {
            status: 'published',
            limit: 100,
            cursor,
            q: tripSlug,
          },
        );
        if (!result.success) break;
        const page = z
          .object({
            items: z.array(
              z.object({
                slug: z.string().nullable(),
                data: z.object({
                  asset: z.object({ id: z.string() }).nullish(),
                  poster: z.object({ id: z.string() }).nullish(),
                  source_url: z.string().nullish(),
                  poster_url: z.string().nullish(),
                }),
              }),
            ),
            nextCursor: z.string().nullish(),
          })
          .parse(result.data);
        allowed = page.items.some(({ slug, data }) =>
          assetId
            ? data.asset?.id === assetId || data.poster?.id === assetId
            : slug === tripSlug &&
              [data.source_url, data.poster_url].includes(
                `/_emdash/api/media/file/${key}`,
              ),
        );
        cursor = page.nextCursor ?? undefined;
      } while (!allowed && cursor);
      if (!allowed)
        return new Response('Not found', {
          status: 404,
          headers: { 'Cache-Control': 'private, no-store' },
        });
    }
  }
  const ownerRoute = path.startsWith('/owner') || path.startsWith('/api/trip');
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(context.request.method);
  const management =
    /^\/_emdash\/api\/(admin\/users|users|invites|auth\/(invite|signup)|settings\/signup)(?:\/|$)/.test(
      path,
    );
  if (management) return new Response('Single-owner site', { status: 403 });
  if (ownerRoute) {
    const user = context.locals.user;
    if (!user || user.role < 50)
      return path.startsWith('/api/')
        ? Response.json({ error: 'Sign in required' }, { status: 401 })
        : context.redirect('/_emdash/admin/login?redirect=/owner');
    if (
      mutation &&
      (context.request.headers.get('X-EmDash-Request') !== '1' ||
        context.request.headers.get('Origin') !== context.url.origin)
    )
      return Response.json({ error: 'Request rejected' }, { status: 403 });
  }
  const response = await next();
  if (ownerRoute || mediaFile) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('CDN-Cache-Control', 'no-store');
    response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
});
