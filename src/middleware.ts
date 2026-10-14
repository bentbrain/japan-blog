import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

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
  if (path.startsWith('/_emdash/api/media/file/trip-private/'))
    return new Response('Not found', { status: 404 });
  const ownerRoute = path.startsWith('/owner') || path.startsWith('/api/trip');
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(context.request.method);
  const management =
    /^\/_emdash\/api\/(users|invites|auth\/signup|settings\/signup)/.test(path);
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
  if (ownerRoute) response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
});
