import type { APIRoute } from 'astro';
export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData(),
    file = form.get('file'),
    storage = locals.emdash.storage;
  if (
    !(file instanceof File) ||
    !storage ||
    !['image/png', 'video/mp4'].includes(file.type) ||
    file.size > 32 * 1024 * 1024
  )
    return Response.json({ error: 'Invalid export' }, { status: 400 });
  const id = crypto.randomUUID(),
    extension = file.type === 'image/png' ? 'png' : 'mp4';
  await storage.upload({
    key: `trip-private/exports/${id}.${extension}`,
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
  });
  return Response.json({ url: `/api/trip/exports/${id}.${extension}` });
};
