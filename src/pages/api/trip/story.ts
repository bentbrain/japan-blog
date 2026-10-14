import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  daySchema,
  tokyoDay,
  mediaUrl,
  posterUrl,
  formatDay,
} from '../../../lib/model';
import { tripMedia, beerCounts } from '../../../lib/content';
export const POST: APIRoute = async ({ request }) => {
  const parsed = z
    .object({
      day: daySchema,
      ids: z.array(z.string()).min(1).max(15),
      counter: z.enum(['both', 'today', 'total', 'hidden']),
    })
    .safeParse(await request.json());
  if (!parsed.success)
    return Response.json(
      { error: 'Select up to 15 items from one day' },
      { status: 400 },
    );
  const { day, ids, counter } = parsed.data,
    all = await tripMedia(),
    media = ids.flatMap((id) => {
      const item = all.find(
        (m) => m.id === id && tokyoDay(m.captured_at) === day,
      );
      return item ? [item] : [];
    });
  if (media.length !== ids.length || new Set(ids).size !== ids.length)
    return Response.json(
      { error: 'Selected media is unavailable for this day' },
      { status: 400 },
    );
  return Response.json({
    day,
    title: `${media[0]?.place || 'japan'} / ${formatDay(day)}`,
    counter,
    beers: await beerCounts(day),
    media: media.map((m) => ({
      id: m.id,
      kind: m.kind,
      url: mediaUrl(m),
      poster: posterUrl(m),
      duration: m.duration,
    })),
  });
};
