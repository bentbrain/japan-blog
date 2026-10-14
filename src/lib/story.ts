import { z } from 'zod';
import { daySchema } from './model';
export const storySchema = z.object({
  day: daySchema,
  title: z.string(),
  counter: z.enum(['both', 'today', 'total', 'hidden']),
  beers: z.object({ today: z.number(), total: z.number() }),
  media: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['photo', 'video']),
        url: z.string(),
        poster: z.string(),
        duration: z.number().nullish(),
      }),
    )
    .min(1)
    .max(15),
});
export type Story = z.infer<typeof storySchema>;
export function tileCenters(count: number) {
  const gap = Math.min(75, 480 / Math.max(1, count - 1));
  return Array.from({ length: count }, (_, i) => ({
    x: 540,
    y: 660 + i * gap,
  }));
}
export function drawStory(
  ctx: CanvasRenderingContext2D,
  story: Story,
  images: CanvasImageSource[],
  time = 0,
) {
  ctx.fillStyle = '#0647ff';
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = '#fff';
  ctx.font = '44px "Geist Mono", monospace';
  ctx.fillText(story.title, 85, 350, 900);
  const centers = tileCenters(images.length);
  images.forEach((image, index) => {
    const center = centers[index];
    if (!center) return;
    ctx.save();
    ctx.translate(center.x, center.y + Math.sin(time * 1.5 + index) * 8);
    ctx.transform(0.707, -0.408, 0.707, 0.408, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-318, -218, 636, 436);
    ctx.drawImage(image, -310, -210, 620, 420);
    ctx.strokeStyle = '#0647ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-310, -210, 620, 420);
    ctx.restore();
  });
  if (story.counter !== 'hidden') {
    ctx.fillStyle = '#fff';
    const mug = [
      '0001111111100000',
      '0011000000110000',
      '0010000000111100',
      '0010101010100100',
      '0010101010100100',
      '0010101010100100',
      '0010101010111100',
      '0010101010100000',
      '0010101010100000',
      '0010000000100000',
      '0001111111000000',
    ];
    mug.forEach((row, y) => {
      row.split('').forEach((bit, x) => {
        if (bit === '1') ctx.fillRect(700 + x * 5, 1430 + y * 5, 5, 5);
      });
    });
    ctx.font = '44px "Geist Mono", monospace';
    ctx.fillText(
      String(
        story.counter === 'total' ? story.beers.total : story.beers.today,
      ).padStart(2, '0'),
      800,
      1468,
    );
    ctx.font = '30px "Geist Mono", monospace';
    ctx.fillText(
      story.counter === 'both'
        ? `today / ${String(story.beers.total)} total`
        : story.counter,
      700,
      1530,
      310,
    );
  }
}
