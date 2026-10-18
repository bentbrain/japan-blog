import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { decode } from 'fast-png';
import { z } from 'zod';

const title = 'Synthetic responsive gallery';
const fixtureRun = crypto.randomUUID();
const createdSchema = z.object({
  data: z.object({ item: z.object({ id: z.string() }) }),
});
const revisionSchema = z.object({ data: z.object({ _rev: z.string() }) });
const mediaIds: string[] = [];
let postId = '';
let followingPostId = '';
function picture(shape: string) {
  const width = shape === 'portrait' ? 160 : 320,
    height = shape === 'portrait' ? 240 : 160;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}"><rect width="100%" height="100%" fill="#ee3333"/><rect x="4" y="4" width="${String(width - 8)}" height="${String(height - 8)}" fill="none" stroke="#33ee33" stroke-width="8"/><text x="12" y="45" fill="white" font-size="14">synthetic ${shape}</text></svg>`;
}

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
      data: { slug: `${slug}-${fixtureRun}`, data },
    });
    expect(response.ok()).toBe(true);
    const id = createdSchema.parse(await response.json()).data.item.id;
    const current = revisionSchema.parse(
      await (
        await request.get(`/_emdash/api/content/${collection}/${id}`)
      ).json(),
    );
    expect(
      (
        await request.post(`/_emdash/api/content/${collection}/${id}/publish`, {
          headers,
          data: { _rev: current.data._rev },
        })
      ).ok(),
    ).toBe(true);
    return id;
  }
  for (const [index, item] of [
    { kind: 'photo', shape: 'portrait' },
    { kind: 'video', shape: 'portrait' },
    { kind: 'video', shape: 'landscape' },
    { kind: 'photo', shape: 'landscape' },
  ].entries()) {
    mediaIds.push(
      await create('media_items', `responsive-fixture-${String(index)}`, {
        title: `Synthetic ${item.shape} ${item.kind}`,
        kind: item.kind,
        captured_at: `2097-10-15T0${String(index)}:00:00Z`,
        latitude: 35.6,
        longitude: 139.7,
        place: 'synthetic fixture',
        categories: [],
        demo: true,
        source_url: `/demo/responsive-${item.shape}.${item.kind === 'video' ? 'mp4' : 'svg'}`,
        poster_url: `/demo/responsive-${item.shape}.svg`,
        ...(item.kind === 'video' ? { duration: 2 } : {}),
      }),
    );
  }
  postId = await create('posts', 'synthetic-responsive-gallery', {
    title,
    day: '2097-10-15',
    place: 'synthetic fixture',
    gallery: mediaIds,
    demo: true,
    shop_design: {
      productUrl:
        'https://shop.bent.build/featured/3d8ed467-55d4-45ed-ba9d-1eeb687fa5bc',
      color: 'white',
    },
  });
  const finalPhoto = mediaIds.at(-1);
  if (!finalPhoto) throw new Error('Following post fixture photo required');
  followingPostId = await create('posts', 'synthetic-following-post', {
    title: 'Synthetic following post',
    day: '2096-10-15',
    gallery: [finalPhoto],
    demo: true,
  });
});

test.afterAll(async ({ request, baseURL }) => {
  await request.get('/_emdash/api/auth/dev-bypass');
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL || '' };
  if (followingPostId)
    expect(
      (
        await request.delete(`/_emdash/api/content/posts/${followingPostId}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
  if (postId)
    expect(
      (
        await request.delete(`/_emdash/api/content/posts/${postId}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
  for (const id of mediaIds)
    expect(
      (
        await request.delete(`/_emdash/api/content/media_items/${id}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
});

test.beforeEach(async ({ page }) => {
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  await page.route('**/demo/responsive-*.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: picture(
        route.request().url().includes('portrait') ? 'portrait' : 'landscape',
      ),
    }),
  );
  await page.route('**/demo/responsive-*.mp4', async (route) => {
    const body = await readFile(
      new URL(
        `../fixtures/gallery-${route.request().url().includes('portrait') ? 'portrait' : 'landscape'}.mp4`,
        import.meta.url,
      ),
    );
    const range = /^bytes=(\d+)-(\d*)$/.exec(
      route.request().headers()['range'] ?? '',
    );
    const startText = range?.[1];
    if (startText !== undefined) {
      const start = Number(startText);
      const end = Math.min(
        Number(range?.[2] || body.length - 1),
        body.length - 1,
      );
      if (start > end) {
        await route.fulfill({
          status: 416,
          headers: { 'Content-Range': `bytes */${String(body.length)}` },
        });
        return;
      }
      await route.fulfill({
        status: 206,
        contentType: 'video/mp4',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${String(start)}-${String(end)}/${String(body.length)}`,
        },
        body: body.subarray(start, end + 1),
      });
      return;
    }
    await route.fulfill({
      contentType: 'video/mp4',
      headers: { 'Accept-Ranges': 'bytes' },
      body,
    });
  });
  await page.route(
    'https://shop.bent.build/api/configured-product-image/**',
    (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="white"/><text x="20" y="150" fill="#0647ff">synthetic shirt</text></svg>',
      }),
  );
});

function paintedBounds(png: Uint8Array) {
  const { width, height, data, channels } = decode(png);
  if (channels < 3) throw new Error('Colour screenshot required');
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      if (
        (data[offset + 1] ?? 0) > 150 &&
        (data[offset] ?? 0) < 120 &&
        (data[offset + 2] ?? 0) < 120
      ) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < left || bottom < top)
    throw new Error('Uncropped synthetic green frame required');
  return { width: right - left + 1, height: bottom - top + 1 };
}

async function openGallery(page: Page) {
  await page.goto('/');
  const card = page.locator('article').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(
    card.locator('astro-island[component-export="PostMedia"][ssr]'),
  ).toHaveCount(0);
  await card.locator('img').evaluateAll(async (images) =>
    Promise.all(
      images.map(async (image) => {
        if (image instanceof HTMLImageElement) {
          image.loading = 'eager';
          await image.decode();
        }
      }),
    ),
  );
  await expect
    .poll(() =>
      card
        .locator('video')
        .evaluateAll((videos) =>
          videos.every(
            (video) =>
              video instanceof HTMLVideoElement && video.readyState >= 1,
          ),
        ),
    )
    .toBe(true);
  await card.evaluate((element) => {
    window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 80);
  });
  await page.evaluate(() => document.fonts.ready);
  return card;
}
async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [from],
  });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / 10,
          y: from.y + ((to.y - from.y) * i) / 10,
        },
      ],
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
    );
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

for (const scheme of ['light', 'dark']) {
  test(`mobile home gallery stays bounded, uncropped and scrollable in ${scheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({
      colorScheme: scheme === 'dark' ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });
    const card = await openGallery(page);
    if (process.env.HOME_GALLERY_EVIDENCE)
      await page.screenshot({
        caret: 'initial',
        path: `${process.env.HOME_GALLERY_EVIDENCE}/mobile-${scheme}.png`,
      });
    const content = card.locator('.post-media');
    expect(
      await content.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeLessThanOrEqual(321);
    const frame = card.locator('[data-slot="carousel-content"]');
    const initialHeight = await frame.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    expect(initialHeight).toBeGreaterThan(200);
    const metrics: {
      slide: number;
      naturalWidth: number;
      naturalHeight: number;
      paint: { width: number; height: number };
      frameHeight: number;
    }[] = [];
    for (let i = 0; i < 5; i++) {
      const slide = card.locator('[data-slot="carousel-item"]').nth(i);
      const media = slide.locator('.media-tile img, video');
      if (i < 4) {
        await expect(media).toHaveCSS('object-fit', 'contain');
        const dimensions = await media.evaluate((element) => ({
          width:
            element instanceof HTMLVideoElement
              ? element.videoWidth
              : element instanceof HTMLImageElement
                ? element.naturalWidth
                : 0,
          height:
            element instanceof HTMLVideoElement
              ? element.videoHeight
              : element instanceof HTMLImageElement
                ? element.naturalHeight
                : 0,
        }));
        expect(dimensions.width / dimensions.height).toBeCloseTo(
          i < 2 ? 2 / 3 : 2,
          2,
        );
        if (i === 1 || i === 2)
          await media.evaluate(async (element) => {
            if (!(element instanceof HTMLVideoElement))
              throw new Error('Video fixture required');
            element.muted = true;
            await element.play();
            element.pause();
            element.controls = false;
          });
        let paint;
        try {
          paint = paintedBounds(await media.screenshot({ caret: 'initial' }));
        } finally {
          if (i === 1 || i === 2)
            await media.evaluate((element) => {
              if (element instanceof HTMLVideoElement) element.controls = true;
            });
        }
        expect(paint.width / paint.height).toBeCloseTo(
          dimensions.width / dimensions.height,
          2,
        );
        metrics.push({
          slide: i + 1,
          naturalWidth: dimensions.width,
          naturalHeight: dimensions.height,
          paint,
          frameHeight: initialHeight,
        });
        if (process.env.HOME_GALLERY_EVIDENCE && (i === 1 || i === 2))
          await page.screenshot({
            caret: 'initial',
            path: `${process.env.HOME_GALLERY_EVIDENCE}/mobile-${scheme}-${i === 1 ? 'portrait' : 'landscape'}-video.png`,
          });
      } else {
        await expect(slide.locator('.post-design-link')).toBeInViewport();
      }
      expect(
        await frame.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBeCloseTo(initialHeight, 0);
      if (i < 4) {
        await card.getByRole('button', { name: 'Next slide' }).click();
        if (i === 0) {
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    resolve();
                  }),
                ),
              ),
          );
          const expected = await frame.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.left - box.width;
          });
          expect(
            await card
              .locator('[data-slot="carousel-item"]')
              .first()
              .evaluate((element) => element.getBoundingClientRect().left),
          ).toBeCloseTo(expected, 0);
        }
      }
    }
    await expect(
      card.getByRole('button', { name: 'Next slide' }),
    ).toBeDisabled();
    for (let i = 0; i < 4; i++)
      await card.getByRole('button', { name: 'Previous slide' }).click();
    if (process.env.HOME_GALLERY_EVIDENCE)
      await writeFile(
        `${process.env.HOME_GALLERY_EVIDENCE}/mobile-${scheme}-dimensions.json`,
        JSON.stringify(metrics, null, 2),
      );
    const photoBounds = await frame.boundingBox();
    if (!photoBounds) throw new Error('Photo gesture bounds required');
    const photoScroll = await page.evaluate(() => scrollY);
    await swipe(
      page,
      {
        x: photoBounds.x + photoBounds.width / 2,
        y: photoBounds.y + initialHeight - 65,
      },
      { x: photoBounds.x + photoBounds.width / 2, y: photoBounds.y + 30 },
    );
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(photoScroll + 80);
    await card.evaluate((element) => {
      window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 80);
    });
    const bounds = await frame.boundingBox();
    if (!bounds) throw new Error('Gallery bounds required');
    const before = await page.evaluate(() => scrollY);
    await swipe(
      page,
      { x: bounds.x + bounds.width - 35, y: bounds.y + 100 },
      { x: bounds.x + 35, y: bounds.y + 100 },
    );
    await expect(card.getByText('2 / 5', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
    const video = card.locator('video').first();
    const videoState = () =>
      video.evaluate((element) => {
        if (!(element instanceof HTMLVideoElement))
          throw new Error('Video fixture required');
        return {
          paused: element.paused,
          seeking: element.seeking,
          currentTime: element.currentTime,
        };
      });
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).toHaveAttribute('playsinline', '');
    await video.evaluate((element) => {
      if (!(element instanceof HTMLVideoElement))
        throw new Error('Video fixture required');
      element.muted = true;
    });
    await expect.poll(async () => !(await videoState()).paused).toBe(true);
    await video.press('Space');
    await expect.poll(async () => (await videoState()).paused).toBe(true);
    await video.press('Space');
    await expect.poll(async () => !(await videoState()).paused).toBe(true);
    const videoSwipeBounds = await frame.boundingBox();
    if (!videoSwipeBounds) throw new Error('Video swipe bounds required');
    await swipe(
      page,
      {
        x: videoSwipeBounds.x + videoSwipeBounds.width - 35,
        y: videoSwipeBounds.y + 100,
      },
      { x: videoSwipeBounds.x + 35, y: videoSwipeBounds.y + 100 },
    );
    await expect(card.getByText('3 / 5', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Previous slide' }).click();
    await expect(video).toBeInViewport({ ratio: 1 });
    await video.hover();
    await video.focus();
    await video.evaluate((element) => {
      if (!(element instanceof HTMLVideoElement))
        throw new Error('Video fixture required');
      element.pause();
    });
    const controlBounds = await video.boundingBox();
    if (!controlBounds) throw new Error('Native video controls required');
    await video.evaluate((element) => {
      if (!(element instanceof HTMLVideoElement))
        throw new Error('Video fixture required');
      element.currentTime = 0;
    });
    await expect.poll(async () => (await videoState()).seeking).toBe(false);
    await page.mouse.click(
      controlBounds.x + controlBounds.width * 0.65,
      controlBounds.y + controlBounds.height - 20,
    );
    await expect
      .poll(async () => (await videoState()).currentTime)
      .toBeGreaterThan(0.4);
    expect((await videoState()).paused).toBe(true);
    await video.evaluate((element) => {
      if (!(element instanceof HTMLVideoElement))
        throw new Error('Video fixture required');
      element.currentTime = 0;
    });
    await page.mouse.click(
      controlBounds.x + 18,
      controlBounds.y + controlBounds.height - 48,
    );
    await expect.poll(async () => !(await videoState()).paused).toBe(true);
    const playingBounds = await frame.boundingBox();
    if (!playingBounds) throw new Error('Video bounds required');
    await swipe(
      page,
      {
        x: playingBounds.x + playingBounds.width / 2,
        y: playingBounds.y + initialHeight - 65,
      },
      { x: playingBounds.x + playingBounds.width / 2, y: playingBounds.y + 30 },
    );
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(before + 80);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
  });
}

test('desktop feed keeps equal-width natural-height vertical media', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  const card = await openGallery(page);
  if (process.env.HOME_GALLERY_EVIDENCE)
    await page.screenshot({
      caret: 'initial',
      path: `${process.env.HOME_GALLERY_EVIDENCE}/desktop.png`,
    });
  const boxes = await card.locator('.media-tile').evaluateAll((tiles) =>
    tiles.map((element) => {
      const b = element.getBoundingClientRect();
      return {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        bottom: b.bottom,
      };
    }),
  );
  expect(boxes).toHaveLength(4);
  for (const [i, box] of boxes.entries()) {
    expect(box.width).toBeCloseTo(boxes[0]?.width || 0, 0);
    expect(box.x).toBeCloseTo(boxes[0]?.x || 0, 0);
    if (i) expect(box.y).toBeGreaterThanOrEqual(boxes[i - 1]?.bottom || 0);
    expect(box.width / box.height).toBeCloseTo(i < 2 ? 2 / 3 : 2, 2);
  }
  await expect(card.getByRole('button', { name: 'Next slide' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    1280,
  );
});

test('feed reactivates its mobile carousel across the 601px breakpoint and bounds short viewports', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 500 });
  const card = await openGallery(page);
  const content = card.locator('.post-media');
  await expect(content).toHaveCSS('height', '250px');
  await expect(card.getByRole('button', { name: 'Next slide' })).toBeVisible();
  await page.setViewportSize({ width: 601, height: 500 });
  await expect(content).toHaveCSS('display', 'grid');
  await expect(
    card.getByRole('button', { name: 'Next slide', includeHidden: true }),
  ).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(content).toHaveCSS('height', '320px');
  await card.getByRole('button', { name: 'Next slide' }).click();
  await expect(card.getByText('2 / 5', { exact: true })).toBeVisible();
});
