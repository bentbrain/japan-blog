import { test, expect } from '@playwright/test';
import { z } from 'zod';

const mediaIds: string[] = [];
const created = z.object({
  data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
});

test.beforeAll(async ({ request, baseURL }) => {
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL || '' };
  expect(
    (
      await request.post('/_emdash/api/setup/dev-bypass', { headers, data: {} })
    ).ok(),
  ).toBe(true);
  await request.get('/_emdash/api/auth/dev-bypass');
  for (let index = 0; index < 9; index++) {
    const response = await request.post('/_emdash/api/content/media_items', {
      headers,
      data: {
        slug: `masonry-${String(index)}`,
        data: {
          title: `Synthetic masonry ${String(index)}`,
          kind: index === 4 ? 'video' : 'photo',
          duration: index === 4 ? 6 : null,
          captured_at: `2099-10-15T${String(index).padStart(2, '0')}:00:00Z`,
          latitude: 35.6,
          longitude: 139.7,
          place: 'synthetic fixture',
          categories: ['masonry', index % 2 ? 'portrait' : 'landscape'],
          source_url:
            index === 4
              ? '/demo/sample.mp4'
              : `/demo/masonry-${String(index)}.svg`,
          poster_url: `/demo/masonry-${String(index)}.svg`,
          demo: true,
        },
      },
    });
    expect(response.ok()).toBe(true);
    const { data } = created.parse(await response.json());
    mediaIds.push(data.item.id);
    expect(
      (
        await request.post(
          `/_emdash/api/content/media_items/${data.item.id}/publish`,
          {
            headers,
            data: { _rev: data._rev },
          },
        )
      ).ok(),
    ).toBe(true);
  }
});

test.afterAll(async ({ request, baseURL }) => {
  await request.get('/_emdash/api/auth/dev-bypass');
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL || '' };
  for (const id of mediaIds) {
    expect(
      (
        await request.delete(`/_emdash/api/content/media_items/${id}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
  }
});

for (const width of [390, 601, 901, 1280]) {
  test(`gallery masonry preserves media and filters at ${String(width)}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/demo/masonry-*.svg', (route) => {
      const index = Number(/masonry-(\d+)/.exec(route.request().url())?.[1]);
      const height = index % 2 ? 420 : 180;
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${String(height)}"><rect width="100%" height="100%" fill="#dbe8ff"/></svg>`,
      });
    });
    await page.goto('/gallery?category=masonry&keep=1');
    const grid = page.locator('.gallery-grid');
    const tiles = grid.locator('> [data-categories]:visible');
    await expect(tiles).toHaveCount(9);
    await grid.locator('img').evaluateAll(async (images) => {
      await Promise.all(
        images.map(async (image) => {
          if (image instanceof HTMLImageElement) {
            image.loading = 'eager';
            await image.decode();
          }
        }),
      );
    });
    const boxes = await tiles.evaluateAll((elements) =>
      elements.map((el) => {
        const box = el.getBoundingClientRect();
        return { x: box.x, y: box.y, bottom: box.bottom, width: box.width };
      }),
    );
    const columns = [...new Set(boxes.map((box) => Math.round(box.x)))];
    expect(columns).toHaveLength(width > 900 ? 3 : width > 600 ? 2 : 1);
    for (const x of columns) {
      const column = boxes.filter((box) => Math.round(box.x) === x);
      for (const [index, box] of column.entries()) {
        const previous = column[index - 1];
        if (previous) expect(box.y - previous.bottom).toBeCloseTo(7, 0);
      }
    }
    if (width === 1280) {
      await page.screenshot({ path: testInfo.outputPath('after-masonry.png') });
      await page.addStyleTag({
        content:
          '.gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); } .gallery-grid > div { margin-bottom: 0; }',
      });
      await page.screenshot({
        path: testInfo.outputPath('before-grid-reconstructed.png'),
      });
      await page
        .locator('style')
        .last()
        .evaluate((element) => {
          element.remove();
        });
    }
    expect(await grid.locator('video').getAttribute('controls')).not.toBeNull();
    await expect(
      grid.getByRole('link', { name: 'View Synthetic masonry 4' }),
    ).toHaveAttribute('href', '/media/masonry-4');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const origin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('[data-category="portrait"]').click();
    await expect(tiles).toHaveCount(4);
    await page.goBack();
    await expect(tiles).toHaveCount(9);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    expect(new URL(page.url()).searchParams.get('keep')).toBe('1');
  });
}
