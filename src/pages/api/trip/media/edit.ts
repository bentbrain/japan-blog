import type { APIRoute } from 'astro';
import { z } from 'zod';
import { mediaEditData, mediaEditSchema } from '../../../../lib/media-edits';

export const PATCH: APIRoute = async ({ request, locals }) => {
  if (!locals.user)
    return Response.json({ error: 'Sign in required' }, { status: 401 });
  const parsed = mediaEditSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: 'Choose valid fields to change' },
      { status: 400 },
    );
  const { id, revision, changes } = parsed.data;
  const current = await locals.emdash.handleContentGet('media_items', id);
  if (!current.success || !current.data)
    return Response.json(current, { status: 404 });
  const entry = z
    .object({
      _rev: z.string(),
      item: z.object({
        status: z.string(),
        draftRevisionId: z.string().nullish(),
        data: z.record(z.string(), z.unknown()),
      }),
    })
    .parse(current.data);
  if (entry._rev !== revision)
    return Response.json(
      { error: 'Photo changed. Review it before retrying.' },
      { status: 409 },
    );
  if (!['draft', 'published'].includes(entry.item.status))
    return Response.json(
      { error: 'Only drafts and published photos can be edited' },
      { status: 422 },
    );
  // Publishing a pending revision would also release edits outside this selection.
  if (entry.item.status === 'published' && entry.item.draftRevisionId)
    return Response.json(
      {
        error:
          'Photo has unpublished edits. Save it individually before bulk editing.',
      },
      { status: 409 },
    );
  let data: Record<string, unknown>;
  try {
    data = mediaEditData(entry.item.data, changes);
  } catch {
    return Response.json(
      { error: 'A photo can have at most 20 valid categories' },
      { status: 400 },
    );
  }
  const actor = { id: locals.user.id, role: locals.user.role };
  const saved = await locals.emdash.handleContentUpdate('media_items', id, {
    data,
    _rev: revision,
    actor,
  });
  if (!saved.success || !saved.data)
    return Response.json(saved, { status: 409 });
  // Keep drafts private; apply edits to photos that are already public.
  const result =
    entry.item.status === 'published'
      ? await locals.emdash.handleContentPublish('media_items', id, {
          _rev: z.object({ _rev: z.string() }).parse(saved.data)._rev,
          actor,
          origin: { source: 'api' },
        })
      : saved;
  return Response.json(result, { status: result.success ? 200 : 422 });
};
