import { createHttpAccess } from 'emdash';
import { z } from 'zod';
import { embeddedMediaReferences } from '../plugins/trip-policy';

export const savedImageInput = z.object({
  id: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  revision: z.string().min(1).max(2048),
  source: z.url().max(8192),
});
const savedPost = z.object({
  success: z.literal(true),
  data: z.object({
    _rev: z.string(),
    item: z.object({ data: z.object({ content: z.unknown() }) }),
  }),
});

// Only fetch an image already present in this saved revision. EmDash validates
// DNS and public addresses, rechecks redirects and bounds the response to 8 MiB.
// Restrict redirects to the original host and never forward owner credentials.
export async function savedPostImage(
  input: z.infer<typeof savedImageInput>,
  origin: string,
  getPost: (id: string) => Promise<unknown>,
  readImage = (url: URL) =>
    createHttpAccess('saved-post-image', [url.hostname]).fetch(url.href, {
      signal: AbortSignal.timeout(30_000),
      credentials: 'omit',
    }),
) {
  const post = savedPost.safeParse(await getPost(input.id));
  if (!post.success)
    return Response.json({ error: 'Post not found' }, { status: 404 });
  if (post.data.data._rev !== input.revision)
    return Response.json(
      { error: 'Post changed. Reload before importing its images.' },
      { status: 409 },
    );
  if (
    !embeddedMediaReferences(
      post.data.data.item.data.content,
      'image',
    ).includes(input.source)
  )
    return Response.json({ error: 'Saved image required' }, { status: 400 });
  const url = new URL(input.source);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.origin === origin ||
    url.hostname === 'jp.bent.build'
  )
    return Response.json({ error: 'External image required' }, { status: 400 });
  try {
    const response = await readImage(url);
    const type = response.headers.get('Content-Type')?.split(';')[0]?.trim();
    if (!response.ok || !type?.startsWith('image/')) {
      await response.body?.cancel();
      throw new Error('Image unavailable');
    }
    return new Response(await response.blob(), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json(
      { error: 'Could not import the saved image. Try again.' },
      { status: 422 },
    );
  }
}
