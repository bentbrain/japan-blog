import { getEmDashCollection } from 'emdash';
import { mediaSchema, tokyoDay, type TripMedia } from './model';
import { z } from 'zod';

export async function tripMedia() {
  const items: TripMedia[] = [];
  let cursor: string | undefined;
  do {
    const { entries, nextCursor } = await getEmDashCollection('media_items', {
      status: 'published',
      limit: 100,
      orderBy: { captured_at: 'desc' },
      cursor,
    });
    items.push(
      ...entries.flatMap((entry) => {
        const parsed = mediaSchema.safeParse(entry.data);
        return parsed.success ? [parsed.data] : [];
      }),
    );
    cursor = nextCursor;
  } while (cursor);
  return items;
}
const beerSchema = z.object({
  day: z.string(),
  count: z.number().int().min(0),
});
export async function beerCounts(day = tokyoDay(new Date())) {
  const days: z.infer<typeof beerSchema>[] = [];
  let cursor: string | undefined;
  do {
    const { entries, nextCursor } = await getEmDashCollection('beers', {
      status: 'published',
      limit: 100,
      orderBy: { day: 'desc' },
      cursor,
    });
    days.push(
      ...entries.flatMap((entry) => {
        const parsed = beerSchema.safeParse(entry.data);
        return parsed.success ? [parsed.data] : [];
      }),
    );
    cursor = nextCursor;
  } while (cursor);
  return {
    today: days
      .filter((item) => item.day === day)
      .reduce((sum, item) => sum + item.count, 0),
    total: days
      .filter((item) => item.day <= day)
      .reduce((sum, item) => sum + item.count, 0),
  };
}
