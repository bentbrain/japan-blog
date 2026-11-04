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

// Revalidate every redirect before EmDash checks DNS/public addresses and
// bounds each response to 8 MiB. All hops share one deadline and omit credentials.
async function readSavedImage(url: URL) {
  const http = createHttpAccess('saved-post-image', [url.hostname]);
  const signal = AbortSignal.timeout(30_000);
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.hostname !== url.hostname ||
      current.username ||
      current.password ||
      current.port
    )
      throw new Error('Image redirect rejected');
    const response = await http.fetch(current.href, {
      signal,
      credentials: 'omit',
      redirect: 'manual',
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('Location');
    await response.body?.cancel();
    if (!location) throw new Error('Image redirect required');
    current = new URL(location, current);
  }
  throw new Error('Too many image redirects');
}

// Only fetch an image already present in this saved revision.
export async function savedPostImage(
  input: z.infer<typeof savedImageInput>,
  origin: string,
  getPost: (id: string) => Promise<unknown>,
  readImage = readSavedImage,
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
