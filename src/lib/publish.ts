import { z } from 'zod';
export const savedItemSchema = z.object({ item: z.object({ id: z.string() }) });
export async function publishItem(
  emdash: App.Locals['emdash'],
  collection: string,
  id: string,
  actor: { id: string; role: number },
) {
  const current = await emdash.handleContentGet(collection, id);
  if (!current.success || !current.data) return current;
  return emdash.handleContentPublish(collection, id, {
    _rev: current.data._rev,
    actor,
    origin: { source: 'api' },
  });
}
