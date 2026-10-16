import { test, expect, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encode, decode } from 'fast-png';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

function photoBounds(png: Uint8Array) {
  const { width, height, data } = decode(png);
  let left = width,
    right = 0,
    top = height,
    bottom = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if ((data[offset] || 0) > 200 && (data[offset + 1] || 0) < 80) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  return { width: right - left + 1, height: bottom - top + 1 };
}

async function openSampleExport(page: Page) {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/export');
  await page.waitForURL('**/owner/export');
  await expect(page.getByRole('button', { name: 'EXPORT PNG' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'day', exact: true }).click();
  await page.getByRole('option', { name: '2026-10-15', exact: true }).click();
  await expect(page.getByRole('button', { name: 'EXPORT PNG' })).toBeEnabled();
}

test.beforeAll(async ({ request, baseURL }) => {
  const setup = await request.post('/_emdash/api/setup/dev-bypass', {
    headers: { 'X-EmDash-Request': '1', Origin: baseURL || '' },
    data: {},
  });
  expect(setup.ok()).toBe(true);
  await promisify(execFile)('pnpm', ['demo'], {
    env: { ...process.env, TEST_BASE_URL: baseURL },
  });
});

test.beforeEach(async ({ page }) => {
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  // Exercise portrait and landscape images through the published sample records.
  await page.route('**/demo/*.jpg', (route) => {
    const portrait = route.request().url().endsWith('/tokyo.jpg');
    const width = portrait ? 120 : 240;
    const height = portrait ? 180 : 120;
    return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        encode({
          width,
          height,
          data: Uint8Array.from(
            { length: width * height * 4 },
            (_, index) => [240, 40, 40, 255][index % 4] || 0,
          ),
          channels: 4,
          depth: 8,
        }),
      ),
    });
  });
});

for (const width of [390, 1280]) {
  for (const path of ['/', '/posts/tokyo-after-dark', '/gallery']) {
    test(`published photos retain their full proportions on ${path} at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(path);
      const images = page.locator('.media-tile img');
      expect(await images.count()).toBeGreaterThan(1);
      const ratios = await images.evaluateAll(async (images) =>
        Promise.all(
          images.map(async (image) => {
            if (!(image instanceof HTMLImageElement))
              throw new Error('Photo required');
            image.loading = 'eager';
            await image.decode();
            const box = image.getBoundingClientRect();
            const tile = image.parentElement?.getBoundingClientRect();
            if (!tile) throw new Error('Media tile required');
            return {
              actual: box.width / box.height,
              natural: image.naturalWidth / image.naturalHeight,
              tileHeight: tile.height,
              imageHeight: box.height,
            };
          }),
        ),
      );
      for (const ratio of ratios) {
        expect(ratio.actual).toBeCloseTo(ratio.natural, 2);
        expect(ratio.tileHeight).toBeCloseTo(ratio.imageHeight, 0);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    });
  }

  for (const path of ['/', '/posts/tokyo-after-dark']) {
    test(`post carousel advances and clips its slides on ${path} at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(path);
      const carousel = page
        .locator('.post-carousel[aria-label="tokyo media"]')
        .first();
      const viewport = carousel.locator('[data-slot="carousel-content"]');
      await expect(viewport).toHaveCSS('overflow-x', 'hidden');
      const first = carousel.locator('[data-slot="carousel-item"]').first();
      const before = await first.evaluate(
        (element) => element.getBoundingClientRect().left,
      );
      await carousel.getByRole('button', { name: 'Next slide' }).click();
      await expect(carousel.getByText('2 / 3', { exact: true })).toBeVisible();
      await expect
        .poll(
          async () =>
            before -
            (await first.evaluate(
              (element) => element.getBoundingClientRect().left,
            )),
        )
        .toBeGreaterThan(100);
      await carousel.getByRole('button', { name: 'Previous slide' }).click();
      await expect(carousel.getByText('1 / 3', { exact: true })).toBeVisible();
    });
  }
}

test('post layout responds to its container without changing the viewport', async ({
  page,
}) => {
  await page.goto('/posts/tokyo-after-dark');
  const article = page.locator('.single-post');
  const heading = article.locator('.post-heading');
  const first = article.locator('[data-slot="carousel-item"]').first();
  await expect(heading).toHaveCSS('flex-direction', 'row');
  const wide = await first.evaluate(
    (element) =>
      element.getBoundingClientRect().width /
      (element.closest('.post-carousel')?.getBoundingClientRect().width || 1),
  );
  expect(wide).toBeCloseTo(0.7, 1);
  await article.evaluate((element) => {
    element.style.width = '320px';
  });
  await expect(heading).toHaveCSS('flex-direction', 'column');
  const narrow = await first.evaluate(
    (element) =>
      element.getBoundingClientRect().width /
      (element.closest('.post-carousel')?.getBoundingClientRect().width || 1),
  );
  expect(narrow).toBeCloseTo(0.88, 1);
});

for (const { title, ratio, shape } of [
  { title: 'tokyo / 7', ratio: 2 / 3, shape: 'portrait' },
  { title: 'tokyo / 8', ratio: 2, shape: 'landscape' },
]) {
  test(`story preview and PNG retain ${shape} proportions`, async ({
    page,
  }, info) => {
    await openSampleExport(page);
    const selection = page.locator('#export-selection');
    while (await selection.getByRole('checkbox', { checked: true }).count())
      await selection
        .getByRole('checkbox', { checked: true })
        .first()
        .uncheck();
    await selection
      .locator('.select-media')
      .filter({
        has: page.getByRole('img', { name: title, exact: true }),
      })
      .getByRole('checkbox')
      .check();
    await page.getByRole('combobox', { name: 'card angle' }).click();
    await page.getByRole('option', { name: 'no skew', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'EXPORT PNG' }),
    ).toBeEnabled();
    const preview = await page
      .locator('#story-preview canvas')
      .evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement))
          throw new Error('Preview required');
        return canvas.toDataURL('image/png').split(',')[1] || '';
      });
    const bounds = photoBounds(Buffer.from(preview, 'base64'));
    // The two-pixel border stroke covers one pixel along each photo edge.
    expect(Math.abs(bounds.width - bounds.height * ratio)).toBeLessThanOrEqual(
      3,
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'EXPORT PNG' }).click();
    const file = await download;
    const path = info.outputPath('proportions.png');
    await file.saveAs(path);
    const exported = photoBounds(await readFile(path));
    expect(
      Math.abs(exported.width - exported.height * ratio),
    ).toBeLessThanOrEqual(3);
  });
}

for (const width of [390, 1280]) {
  test(`stack order reaches the renderer at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openSampleExport(page);
    const tiles = page.locator('#export-selection .select-media');
    const original = await tiles.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-media-id')),
    );
    expect(original.length).toBeGreaterThan(1);
    await expect(
      tiles.first().getByRole('button', { name: /toward back/ }),
    ).toBeDisabled();
    await expect(
      tiles.last().getByRole('button', { name: /toward front/ }),
    ).toBeDisabled();
    const response = page.waitForResponse(
      (response) => response.url().endsWith('/api/trip/story') && response.ok(),
    );
    const move = tiles.first().getByRole('button', { name: /toward front/ });
    await move.focus();
    await move.press('Enter');
    const manifest = z
      .object({ media: z.array(z.object({ id: z.string() })) })
      .parse(await (await response).json());
    const expected = [original[1], original[0], ...original.slice(2)];
    expect(manifest.media.map((item) => item.id)).toEqual(expected);
    expect(
      await tiles.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-media-id')),
      ),
    ).toEqual(expected);
    await expect(
      page.getByRole('button', { name: 'EXPORT PNG' }),
    ).toBeEnabled();
    await expect(tiles.nth(1).getByLabel(/Stack position 2 of/)).toBeVisible();
    await tiles.nth(1).getByRole('checkbox').uncheck();
    await expect(tiles.last().getByRole('button')).toHaveCount(0);
    await tiles.last().getByRole('checkbox').check();
    await expect(
      tiles
        .last()
        .getByLabel(
          `Stack position ${String(original.length)} of ${String(original.length)}`,
        ),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}
