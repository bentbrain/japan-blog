import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const createdSchema = z.object({
  data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
});
const run = crypto.randomUUID();
const media: { id: string; slug: string; title: string }[] = [];
const posts: { id: string; slug: string; count: number }[] = [];
const design = {
  productUrl:
    'https://shop.bent.build/product/00000000-0000-4000-8000-000000000001',
  color: 'white',
};

test.beforeAll(async ({ request, baseURL }) => {
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL || '' };
  expect(
    (
      await request.post('/_emdash/api/setup/dev-bypass', { headers, data: {} })
    ).ok(),
  ).toBe(true);
  await request.get('/_emdash/api/auth/dev-bypass');
  async function create(
    collection: string,
    slug: string,
    data: Record<string, unknown>,
  ) {
    const response = await request.post(`/_emdash/api/content/${collection}`, {
      headers,
      data: { slug, data },
    });
    expect(response.status()).toBe(201);
    const { item, _rev } = createdSchema.parse(await response.json()).data;
    expect(
      (
        await request.post(
          `/_emdash/api/content/${collection}/${item.id}/publish`,
          { headers, data: { _rev } },
        )
      ).ok(),
    ).toBe(true);
    return item.id;
  }
  for (const [index, shape] of [
    'portrait',
    'landscape',
    'portrait',
    'landscape',
    'portrait',
    'landscape',
    'tall',
  ].entries()) {
    const slug = `synthetic-mosaic-${run}-${String(index)}`;
    const title = `Synthetic mosaic ${String(index + 1)} ${shape}`;
    const video = index >= 4;
    const id = await create('media_items', slug, {
      title,
      kind: video ? 'video' : 'photo',
      captured_at: '2099-10-15T00:00:00Z',
      latitude: 27.1,
      longitude: 128.4,
      place: 'synthetic fixture',
      categories: [],
      demo: true,
      source_url: `/demo/mosaic-${shape}.${video ? 'mp4' : 'svg'}`,
      poster_url: `/demo/mosaic-${shape}.svg`,
      duration: video ? 6 : null,
    });
    media.push({ id, slug, title });
  }
  for (const count of [0, 1, 2, 3, 4, 5, 7]) {
    const slug = `synthetic-mosaic-post-${run}-${String(count)}`;
    // Reverse capture/insertion order to detect accidental media sorting.
    const id = await create('posts', slug, {
      title: `Synthetic mosaic ${String(count)}`,
      day: '2099-10-15',
      content: [],
      demo: true,
      gallery: media
        .slice(0, count)
        .reverse()
        .map((item) => item.id),
      ...(count === 7 || count === 0 ? { shop_design: design } : {}),
    });
    posts.push({ id, slug, count });
  }
});

test.afterAll(async ({ request, baseURL }) => {
  await request.get('/_emdash/api/auth/dev-bypass');
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL || '' };
  for (const post of posts)
    expect(
      (
        await request.delete(`/_emdash/api/content/posts/${post.id}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
  for (const item of media)
    expect(
      (
        await request.delete(`/_emdash/api/content/media_items/${item.id}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
});

test.beforeEach(async ({ page }) => {
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ body: '' }),
  );
  await page.route(
    'https://shop.bent.build/api/configured-product-image/**',
    (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="white"/><text x="20" y="150" fill="#0647ff">synthetic shirt</text></svg>',
      }),
  );
  await page.route('**/demo/mosaic-*.svg', (route) => {
    const shape = route.request().url().includes('landscape')
      ? 'landscape'
      : route.request().url().includes('tall')
        ? 'tall'
        : 'portrait';
    const width = shape === 'landscape' ? 360 : 180;
    const height = shape === 'landscape' ? 180 : shape === 'tall' ? 540 : 270;
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}"><rect width="100%" height="100%" fill="#c8edda"/><circle cx="90" cy="90" r="50" fill="#0647ff"/></svg>`,
    });
  });
  await page.route('**/demo/mosaic-*.mp4', async (route) => {
    const shape = route.request().url().includes('landscape')
      ? 'landscape'
      : route.request().url().includes('tall')
        ? 'tall'
        : 'portrait';
    const bytes = await readFile(
      new URL(`../fixtures/map-${shape}.mp4`, import.meta.url),
    );
    const range = /^bytes=(\d+)-(\d*)$/.exec(
      route.request().headers()['range'] || '',
    );
    const start = Number(range?.[1] || 0);
    const end = Math.min(
      Number(range?.[2] || bytes.length - 1),
      bytes.length - 1,
    );
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/mp4',
      headers: {
        'Accept-Ranges': 'bytes',
        ...(range
          ? {
              'Content-Range': `bytes ${String(start)}-${String(end)}/${String(bytes.length)}`,
            }
          : {}),
      },
      body: bytes.subarray(start, end + 1),
    });
  });
});

for (const width of [320, 390, 585, 601, 848, 1991]) {
  for (const colorScheme of ['light', 'dark']) {
    test(`mosaic preserves ordered, accessible media at ${String(width)}px in ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width,
        height: width === 1991 ? 1138 : 844,
      });
      await page.emulateMedia({
        colorScheme: colorScheme === 'dark' ? 'dark' : 'light',
        reducedMotion: 'reduce',
      });
      for (const post of posts) {
        const response = await page.goto(`/posts/${post.slug}`);
        expect(response?.status()).toBe(200);
        await expect(page.locator('h1')).toHaveText(
          `Synthetic mosaic ${String(post.count)}`,
        );
        const mosaic = page.getByRole('region', {
          name: `Synthetic mosaic ${String(post.count)} media`,
          exact: true,
        });
        const tiles = mosaic.locator('.media-tile');
        await expect(tiles).toHaveCount(post.count);
        await expect(page.locator('.post-carousel')).toHaveCount(0);
        const expected = media.slice(0, post.count).reverse();
        expect(
          await tiles.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-feedback-id')),
          ),
        ).toEqual(expected.map((item) => `media-${item.id}`));
        const boxes: { x: number; y: number; width: number; height: number }[] =
          [];
        for (const [index, item] of expected.entries()) {
          const tile = tiles.nth(index);
          const link = tile
            .getByRole('link')
            .or(tile.and(page.getByRole('link')));
          await expect(link).toHaveAttribute('href', `/media/${item.slug}`);
          const photo = tile.getByRole('img');
          if (await photo.count()) {
            await expect(photo).toHaveAttribute('alt', item.title);
            await expect(photo).toHaveAttribute('loading', 'lazy');
            await photo.evaluate(async (element) => {
              if (element instanceof HTMLImageElement) {
                element.loading = 'eager';
                await element.decode();
              }
            });
            await expect(photo).toHaveCSS('object-fit', 'contain');
          } else {
            await expect(
              tile.getByLabel(item.title, { exact: true }),
            ).toHaveAttribute('controls', '');
          }
          const box = await tile.boundingBox();
          if (!box) throw new Error('Visible mosaic media required');
          const previous = boxes.at(-1);
          if (previous)
            expect(
              box.y > previous.y ||
                (Math.abs(box.y - previous.y) < 1 && box.x > previous.x),
            ).toBe(true);
          boxes.push(box);
        }
        const first = boxes[0];
        const second = boxes[1];
        const third = boxes[2];
        if (first && second) {
          if (width < 601)
            expect(second.y).toBeGreaterThan(first.y + first.height);
          else if (post.count % 2 === 0)
            expect(second.y).toBeCloseTo(first.y, 0);
          else if (third) {
            expect(first.width).toBeGreaterThan(second.width * 1.9);
            expect(third.y).toBeCloseTo(second.y, 0);
          }
        }
        if (post.count === 0 || post.count === 7) {
          const shop = mosaic.getByRole('link', {
            name: 'Shop this design on a white t-shirt',
          });
          await expect(shop).toHaveAttribute('href', /Color=White/);
          if (boxes.length) {
            const box = await shop.boundingBox();
            const last = boxes.at(-1);
            if (!box || !last) throw new Error('Design bounds required');
            expect(box.y).toBeGreaterThan(last.y + last.height);
          }
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
        const article = await page.locator('article').boundingBox();
        if (!article) throw new Error('Post required');
        expect(article.x).toBeGreaterThanOrEqual(width < 601 ? 16 : 24);
        expect(article.width).toBeLessThanOrEqual(800);
      }
    });
  }
}

for (const width of [390, 1280]) {
  test(`mosaic video keeps native playback, seeking, visibility and media navigation at ${String(width)}px`, async ({
    page,
  }) => {
    const post = posts.find((post) => post.count === 7);
    if (!post) throw new Error('Mixed media post required');
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/posts/${post.slug}`);
    const videos = page.locator('.post-mosaic video');
    await expect(videos).toHaveCount(3);
    for (const video of await videos.all()) {
      await video.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          video.evaluate((element) =>
            element instanceof HTMLVideoElement ? element.readyState : 0,
          ),
        )
        .toBeGreaterThanOrEqual(2);
      await expect(video).toHaveAttribute('playsinline', '');
      await video.evaluate(async (element) => {
        if (!(element instanceof HTMLVideoElement))
          throw new Error('Video required');
        element.muted = true;
        await element.play();
      });
      await expect
        .poll(() =>
          video.evaluate(
            (element) => element instanceof HTMLVideoElement && !element.paused,
          ),
        )
        .toBe(true);
      await video.press('Space');
      await expect
        .poll(() =>
          video.evaluate(
            (element) => element instanceof HTMLVideoElement && element.paused,
          ),
        )
        .toBe(true);
      await video.press('Space');
      await expect
        .poll(() =>
          video.evaluate(
            (element) => element instanceof HTMLVideoElement && !element.paused,
          ),
        )
        .toBe(true);
      await video.evaluate((element) => {
        if (element instanceof HTMLVideoElement) {
          element.pause();
          element.currentTime = 2;
        }
      });
      await expect
        .poll(() =>
          video.evaluate((element) =>
            element instanceof HTMLVideoElement ? element.currentTime : 0,
          ),
        )
        .toBeCloseTo(2, 1);
      await page.evaluate(() => {
        scrollTo(0, document.documentElement.scrollHeight);
      });
      await expect
        .poll(() =>
          video.evaluate(
            (element) => element instanceof HTMLVideoElement && element.paused,
          ),
        )
        .toBe(true);
    }
    const first = media[0];
    if (!first) throw new Error('Photo required');
    const photo = page.getByRole('link', { name: first.title, exact: true });
    await photo.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/media/${first.slug}$`));
    await expect(
      page.getByRole('img', { name: first.title, exact: true }),
    ).toBeVisible();
  });
}
