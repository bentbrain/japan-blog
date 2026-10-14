import { test, expect } from '@playwright/test';
import { z } from 'zod';

const spriteCategories = ['landscape', 'food', 'shopping', 'beer'];

test.beforeAll(async ({ request, baseURL }) => {
  const setup = await request.post('/_emdash/api/setup/dev-bypass', {
    headers: { 'X-EmDash-Request': '1', Origin: baseURL ?? '' },
    data: {},
  });
  expect(setup.ok()).toBe(true);
  await request.get('/_emdash/api/auth/dev-bypass');
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  const listed = await request.get(
    '/_emdash/api/content/media_items?limit=100',
  );
  const existing = z
    .object({
      data: z.object({
        items: z.array(
          z.object({ id: z.string(), slug: z.string().nullable() }),
        ),
      }),
    })
    .parse(await listed.json())
    .data.items.find((item) => item.slug === 'gallery-alignment-fixture');
  let id = existing?.id;
  if (!id) {
    const created = await request.post('/_emdash/api/content/media_items', {
      headers,
      data: {
        slug: 'gallery-alignment-fixture',
        data: {
          title: 'Synthetic gallery alignment fixture',
          kind: 'photo',
          captured_at: '2099-10-15T12:00:00+09:00',
          latitude: 35.6895,
          longitude: 139.6917,
          place: 'synthetic fixture',
          categories: spriteCategories,
          source_url: '/demo/japan.jpg',
          demo: true,
        },
      },
    });
    expect(created.ok()).toBe(true);
    id = z
      .object({ data: z.object({ item: z.object({ id: z.string() }) }) })
      .parse(await created.json()).data.item.id;
  }
  const current = await request.get(`/_emdash/api/content/media_items/${id}`);
  const revision = z
    .object({ data: z.object({ _rev: z.string() }) })
    .parse(await current.json()).data._rev;
  const published = await request.post(
    `/_emdash/api/content/media_items/${id}/publish`,
    { headers, data: { _rev: revision } },
  );
  expect(published.ok()).toBe(true);
});

for (const width of [390, 1778]) {
  for (const textScale of [1, 2]) {
    for (const colorScheme of ['light', 'dark']) {
      test(`gallery sprite paint centers on text at ${String(width)}px, ${String(textScale * 100)}% text, ${colorScheme}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1024 });
        await page.emulateMedia({
          colorScheme: colorScheme === 'dark' ? 'dark' : 'light',
        });
        await page.route('https://toolbar.bent.build/embed.js', (route) =>
          route.fulfill({ contentType: 'application/javascript', body: '' }),
        );
        for (const selected of ['all', 'landscape']) {
          await page.goto(`/gallery?category=${selected}`);
          await page
            .locator('[data-feedback-id="gallery-filters"] a')
            .evaluateAll((links, scale) => {
              for (const link of links) {
                if (link instanceof HTMLElement)
                  link.style.fontSize = `${String(13 * scale)}px`;
              }
            }, textScale);
          await page.evaluate(() => document.fonts.ready);
          const filters = page.locator('[data-feedback-id="gallery-filters"]');
          await expect(filters.locator('a').nth(1)).toHaveText('landscape');
          for (const link of await filters.locator('a').all())
            await expect(link).toHaveCSS(
              'font-size',
              `${String(13 * textScale)}px`,
            );
          if (process.env.GALLERY_EVIDENCE && selected === 'all') {
            await page.screenshot({
              path: `${process.env.GALLERY_EVIDENCE}/gallery-${String(width)}-${String(textScale)}-${colorScheme}.png`,
              clip: { x: 0, y: 0, width, height: width === 390 ? 340 : 180 },
            });
          }
          for (const name of spriteCategories) {
            const link = filters.getByRole('link', { name, exact: true });
            const metrics = await link.evaluate((anchor) => {
              const path = anchor.querySelector('path');
              const svg = anchor.querySelector('svg');
              const text = [...anchor.childNodes].find(
                (node) =>
                  node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
              );
              if (!(path instanceof SVGGraphicsElement) || !svg || !text)
                throw new Error('Rendered sprite and category text required');
              const bounds = path.getBBox();
              const transform = path.getScreenCTM();
              if (!transform)
                throw new Error('Rendered sprite transform required');
              const top = new DOMPoint(bounds.x, bounds.y).matrixTransform(
                transform,
              ).y;
              const bottom = new DOMPoint(
                bounds.x,
                bounds.y + bounds.height,
              ).matrixTransform(transform).y;
              const range = document.createRange();
              range.selectNodeContents(text);
              const line = range.getBoundingClientRect();
              const box = svg.getBoundingClientRect();
              return {
                paintCenter: (top + bottom) / 2,
                textCenter: (line.top + line.bottom) / 2,
                top,
                bottom,
                boxTop: box.top,
                boxBottom: box.bottom,
                iconSize: box.width,
                fontSize: parseFloat(getComputedStyle(anchor).fontSize),
              };
            });
            expect
              .soft(
                Math.abs(metrics.paintCenter - metrics.textCenter),
                `${name}: ${JSON.stringify(metrics)}`,
              )
              .toBeLessThanOrEqual(0.75);
            expect
              .soft(metrics.top, name)
              .toBeGreaterThanOrEqual(metrics.boxTop);
            expect
              .soft(metrics.bottom, name)
              .toBeLessThanOrEqual(metrics.boxBottom);
            expect
              .soft(metrics.iconSize, name)
              .toBeCloseTo(1.7 * metrics.fontSize, 1);
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBe(width);
        }
      });
    }
  }
}
