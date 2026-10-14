import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSchema } from '@tiptap/core';
import { editorExtensions } from '../../../lib/editor-extensions';
import { editorPostSchema, postInputSchema } from '../../../lib/editor-model';
import {
  fromEditorDocument,
  contentForSave,
  preservesContent,
  toEditorDocument,
} from '../../../lib/editor-conversion';
import { publishItem, savedItemSchema } from '../../../lib/publish';
const portableBlocks = z.array(
  z.looseObject({ _type: z.string(), _key: z.string() }),
);
export const GET: APIRoute = async ({ locals, url }) => {
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'Post required' }, { status: 400 });
  const result = await locals.emdash.handleContentGet('posts', id);
  if (!result.success || !result.data)
    return Response.json({ error: 'Post not found' }, { status: 404 });
  const data = z
    .object({
      title: z.string(),
      day: z.string(),
      place: z.string().nullish(),
      gallery: z.array(z.string()).nullish(),
      content: portableBlocks.nullish(),
    })
    .parse(result.data.item.data);
  let document;
  try {
    document = toEditorDocument(data.content || []);
    const reconstructed = getSchema(editorExtensions).nodeFromJSON(document);
    reconstructed.check();
    document = editorPostSchema.shape.data.shape.document.parse(
      reconstructed.toJSON(),
    );
    if (
      data.content?.length &&
      !preservesContent(data.content, fromEditorDocument(document))
    )
      throw new Error('Lossy conversion');
  } catch {
    return Response.json(
      {
        error:
          'This post uses content that needs the native CMS editor. Open it there to keep all blocks.',
      },
      { status: 422 },
    );
  }
  return Response.json({
    id,
    revision: result.data._rev,
    status: result.data.item.status,
    data: {
      title: data.title,
      day: data.day,
      place: data.place || '',
      gallery: data.gallery || [],
      document,
    },
  });
};
export const POST: APIRoute = async ({ locals, request }) => {
  const input = postInputSchema.safeParse(await request.json());
  if (!input.success || !locals.user)
    return Response.json({ error: 'Choose a title and day' }, { status: 400 });
  const { id, revision, document, publish, ...fields } = input.data;
  if (id && !revision)
    return Response.json({ error: 'Post revision required' }, { status: 400 });
  let content;
  try {
    content = contentForSave(document);
  } catch {
    return Response.json(
      {
        error:
          'This layout cannot be saved safely. Move media outside lists and quotes, or use the CMS editor.',
      },
      { status: 400 },
    );
  }
  const actor = { id: locals.user.id, role: locals.user.role };
  const data = { ...fields, content };
  const saved = id
    ? await locals.emdash.handleContentUpdate('posts', id, {
        data,
        _rev: revision,
        actor,
      })
    : await locals.emdash.handleContentCreate('posts', {
        data,
        slug: `post-${fields.day}-${crypto.randomUUID()}`,
        actor,
      });
  if (!saved.success) return Response.json(saved, { status: 409 });
  const postId = id || savedItemSchema.parse(saved.data).item.id;
  let publicationError: string | undefined;
  if (publish) {
    const result = await publishItem(locals.emdash, 'posts', postId, actor);
    if (!result.success)
      publicationError =
        result.error?.message || 'Post saved, publication rejected';
  }
  const current = await locals.emdash.handleContentGet('posts', postId);
  if (!current.success || !current.data)
    return Response.json(current, { status: 500 });
  return Response.json({
    post: {
      id: postId,
      revision: current.data._rev,
      status: current.data.item.status,
      data: { ...fields, document },
    },
    publicationError,
  });
};
