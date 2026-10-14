import type { APIRoute } from 'astro';
import { z } from 'zod';
import { daySchema } from '../../../lib/model';
import { publishItem, savedItemSchema } from '../../../lib/publish';

export const POST: APIRoute = async ({ request, locals }) => {
  const parsed = z
    .object({ day: daySchema, count: z.number().int().min(0).max(100) })
    .safeParse(await request.json());
  if (!parsed.success || !locals.user)
    return Response.json({ error: 'Choose a day and count' }, { status: 400 });
  const { day, count } = parsed.data;
  const result = await locals.emdash.handleContentList('beers', {
    fieldFilters: { day },
    limit: 2,
  });
  if (!result.success) return Response.json(result, { status: 500 });
  const listed = z
    .object({ items: z.array(z.object({ id: z.string() })) })
    .parse(result.data);
  const existing = listed.items[0];
  const actor = { id: locals.user.id, role: locals.user.role };
  let saved;
  if (existing) {
    const current = await locals.emdash.handleContentGet('beers', existing.id);
    if (!current.success || !current.data)
      return Response.json(current, { status: 500 });
    saved = await locals.emdash.handleContentUpdate('beers', existing.id, {
      data: { title: day, day, count },
      _rev: current.data._rev,
      actor,
    });
  } else
    saved = await locals.emdash.handleContentCreate('beers', {
      slug: day,
      data: { title: day, day, count },
      authorId: locals.user.id,
      actor,
    });
  if (!saved.success) return Response.json(saved, { status: 409 });
  const id = savedItemSchema.parse(saved.data).item.id;
  const published = await publishItem(locals.emdash, 'beers', id, actor);
  return Response.json(published, { status: published.success ? 200 : 400 });
};
