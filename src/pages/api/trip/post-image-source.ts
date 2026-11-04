import type { APIRoute } from 'astro';
import { savedImageInput, savedPostImage } from '../../../lib/saved-post-image';

export const POST: APIRoute = async ({ request, locals, url }) => {
  if (!locals.user || locals.user.role < 50)
    return Response.json({ error: 'Sign in required' }, { status: 401 });
  const input = savedImageInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success)
    return Response.json({ error: 'Saved image required' }, { status: 400 });
  return savedPostImage(
    input.data,
    url.origin,
    (id) => locals.emdash.handleContentGet('posts', id),
    undefined,
    (revisionId) => locals.emdash.handleRevisionGet(revisionId),
  );
};
