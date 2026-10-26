import { test, expect, type Locator } from '@playwright/test';
import { z } from 'zod';

const category = 'synthetic masonry';
const ids: string[] = [];
const itemSchema = z.object({
  data: z.object({ item: z.object({ id: z.string() }) }),
});

test.beforeAll(async ({ request, baseURL }) => {
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  expect(
    (
      await request.post('/_emdash/api/setup/dev-bypass', { headers, data: {} })
    ).ok(),
  ).toBe(true);
  await request.get('/_emdash/api/auth/dev-bypass');
  for (let index = 0; index < 8; index++) {
    const created = await request.post('/_emdash/api/content/media_items', {
      headers,
      data: {
        slug: `synthetic-masonry-${crypto.randomUUID()}`,
        data: {
          title: `Synthetic masonry ${String(index + 1)}`,
          kind: 'photo',
          captured_at: `2099-10-15T0${String(index)}:00:00+09:00`,
          latitude: 35.6,
          longitude: 139.7,
          place: 'synthetic fixture',
          categories: [category, ...(index % 2 ? ['synthetic subset'] : [])],
          source_url: `/demo/masonry-${String(index)}.svg`,
          demo: true,
        },
      },
    });
    expect(created.ok()).toBe(true);
    const id = itemSchema.parse(await created.json()).data.item.id;
    ids.push(id);
    const current = await request.get(`/_emdash/api/content/media_items/${id}`);
    const revision = z
      .object({ data: z.object({ _rev: z.string() }) })
      .parse(await current.json()).data._rev;
    expect(
      (
        await request.post(`/_emdash/api/content/media_items/${id}/publish`, {
          headers,
          data: { _rev: revision },
        })
      ).ok(),
    ).toBe(true);
  }
});

test.afterAll(async ({ request, baseURL }) => {
  await request.get('/_emdash/api/auth/dev-bypass');
  for (const id of ids)
    expect(
      (
        await request.delete(`/_emdash/api/content/media_items/${id}`, {
          headers: { 'X-EmDash-Request': '1', Origin: baseURL ?? '' },
        })
      ).ok(),
    ).toBe(true);
});

async function expectPacked(grid: Locator, columns: number) {
  const boxes = await grid
    .locator(':scope > div:not([hidden])')
    .evaluateAll((tiles) =>
      tiles.map((tile) => {
        const box = tile.getBoundingClientRect();
        const media = tile
          .querySelector('.media-tile')
          ?.getBoundingClientRect();
        return {
          x: box.x,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          mediaHeight: media?.height,
        };
      }),
    );
  await expect(grid).toHaveCSS('column-count', String(columns));
  expect(
    new Set(boxes.map((box) => Math.round(box.x))).size,
  ).toBeLessThanOrEqual(columns);
  for (const [index, box] of boxes.entries()) {
    expect(box.height).toBeCloseTo(box.mediaHeight ?? 0, 0);
    const previous = boxes
      .slice(0, index)
      .findLast((other) => Math.abs(other.x - box.x) < 1);
    if (previous) expect(box.top - previous.bottom).toBeCloseTo(7, 0);
  }
  // Native column flow retains the source and keyboard order down each column.
  for (let index = 1; index < boxes.length; index++) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    if (previous && current)
      expect(current.x).toBeGreaterThanOrEqual(previous.x - 1);
  }
}

for (const javaScriptEnabled of [true, false]) {
  test(`gallery packs mixed photo heights with JavaScript ${String(javaScriptEnabled)}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled,
      colorScheme: 'light',
    });
    try {
      const page = await context.newPage();
      await page.route('https://toolbar.bent.build/embed.js', (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' }),
      );
      await page.route('**/demo/masonry-*.svg', (route) => {
        const index = Number(/masonry-(\d+)/.exec(route.request().url())?.[1]);
        const height = index % 2 ? 120 : 240;
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="${String(height)}"><rect width="100%" height="100%" fill="${index % 2 ? '#0647ff' : '#adc4ff'}"/><text x="12" y="35" fill="white" font-size="16">synthetic ${String(index + 1)}</text></svg>`,
        });
      });
      await page.goto(
        `/gallery?category=${encodeURIComponent(category)}&keep=1`,
      );
      const grid = page.locator('[data-feedback-id="gallery-grid"]');
      for (const width of [1280, 601, 600, 390, 901, 900, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        await grid.locator('img').evaluateAll(async (images) => {
          await Promise.all(
            images
              .filter((image) => image.closest('[hidden]') === null)
              .map(async (image) => {
                if (image instanceof HTMLImageElement) {
                  image.loading = 'eager';
                  await image.decode();
                }
              }),
          );
        });
        await page.evaluate(() => document.fonts.ready);
        if (process.env.MASONRY_EVIDENCE && javaScriptEnabled && width === 1280)
          await page.screenshot({
            caret: 'initial',
            path: `${process.env.MASONRY_EVIDENCE}/gallery-1280.png`,
          });
        await expectPacked(grid, width > 900 ? 3 : width > 600 ? 2 : 1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
      }
      const filters = page.getByRole('navigation', {
        name: 'Media categories',
      });
      await filters
        .getByRole('link', { name: 'synthetic subset', exact: true })
        .click();
      await expect(grid.locator(':scope > div:not([hidden])')).toHaveCount(4);
      await expectPacked(grid, 3);
      await page.goBack();
      await expect(grid.locator(':scope > div:not([hidden])')).toHaveCount(8);
      await expectPacked(grid, 3);
      expect(new URL(page.url()).searchParams.get('keep')).toBe('1');
      await grid.locator('a').filter({ visible: true }).first().focus();
      await expect(
        grid.locator('a').filter({ visible: true }).first(),
      ).toBeFocused();
    } finally {
      await context.close();
    }
  });
}
