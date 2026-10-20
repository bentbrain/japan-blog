import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
const fixtureIds: string[] = [];
const result = z.object({
  data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
});

function requestsForPhoto(srcset: string, source: string, requests: string[]) {
  return requests.filter(
    (url) =>
      url === source ||
      srcset.split(',').some((candidate) => {
        const path = candidate.trim().split(' ')[0];
        return path ? url.endsWith(path) : false;
      }),
  );
}

test.beforeAll(async ({ request, baseURL, browser }) => {
  const page = await browser.newPage();
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL || '' };
  expect(
    (
      await request.post('/_emdash/api/setup/dev-bypass', { headers, data: {} })
    ).ok(),
  ).toBe(true);
  await request.get('/_emdash/api/auth/dev-bypass');
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  await page.goto('/');
  const ids = fixtureIds;
  const assetIds: string[] = [];
  const sourceBytes: number[] = [];
  for (const [width, height] of [
    [1200, 1600],
    [1600, 1200],
    [1200, 1200],
  ]) {
    if (!width || !height) throw new Error('Fixture dimensions required');
    const jpeg = await page.evaluate(
      ({ width, height }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas required');
        const pixels = context.createImageData(width, height);
        let seed = 12345;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const noise = (seed >>> 24) / 8;
            const index = (y * width + x) * 4;
            pixels.data[index] =
              (x / width) * 180 + noise + (y % 80 < 3 ? 45 : 0);
            pixels.data[index + 1] = (y / height) * 190 + noise;
            pixels.data[index + 2] = 80 + noise + (x % 100 < 3 ? 70 : 0);
            pixels.data[index + 3] = 255;
          }
        context.putImageData(pixels, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.9).split(',')[1] || '';
      },
      { width, height },
    );
    const buffer = Buffer.from(jpeg, 'base64');
    sourceBytes.push(buffer.length);
    const file = {
      name: 'synthetic-responsive.jpg',
      mimeType: 'image/jpeg',
      buffer,
    };
    const uploaded = await request.post('/api/trip/upload', {
      headers,
      multipart: { original: file, display: file, poster: file },
    });
    expect(uploaded.status()).toBe(201);
    const id = z
      .object({ data: z.object({ item: z.object({ id: z.string() }) }) })
      .parse(await uploaded.json()).data.item.id;
    const currentResponse: unknown = await (
      await request.get(`/_emdash/api/content/media_items/${id}`)
    ).json();
    const current = result.parse(currentResponse).data;
    assetIds.push(
      z
        .object({
          data: z.object({
            item: z.object({
              data: z.object({ asset: z.object({ id: z.string() }) }),
            }),
          }),
        })
        .parse(currentResponse).data.item.data.asset.id,
    );
    const saved = await request.put(`/_emdash/api/content/media_items/${id}`, {
      headers,
      data: {
        _rev: current._rev,
        data: {
          title: `Synthetic ${width > height ? 'landscape' : width === height ? 'square' : 'portrait'}`,
          captured_at: '2099-10-15T00:00:00Z',
          latitude: 27.1,
          longitude: 128.4,
          place: 'synthetic image fixture',
          categories: [],
          demo: true,
        },
      },
    });
    expect(saved.ok()).toBe(true);
    const revision = result.parse(
      await (
        await request.get(`/_emdash/api/content/media_items/${id}`)
      ).json(),
    ).data._rev;
    expect(
      (
        await request.post(`/_emdash/api/content/media_items/${id}/publish`, {
          headers,
          data: { _rev: revision },
        })
      ).ok(),
    ).toBe(true);
    ids.push(id);
  }

  await page.close();
});

for (const width of [390, 671, 672, 1280, 1991])
  for (const height of [390, 844, 1200])
    for (const dpr of [1, 2])
      for (const colorScheme of ['light', 'dark'] satisfies (
        'light' | 'dark'
      )[])
        test(`map fresh selection ${String(width)}x${String(height)} DPR${String(dpr)} ${colorScheme}`, async ({
          browser,
          baseURL,
        }) => {
          const evidence = process.env.MAP_IMAGE_EVIDENCE_DIR;
          if (evidence) await mkdir(evidence, { recursive: true });
          const measurements: unknown[] = [];
          const failures: unknown[] = [];

          const context = await browser.newContext({
            viewport: { width, height },
            colorScheme,
            deviceScaleFactor: dpr,
          });
          await context.route('https://toolbar.bent.build/embed.js', (route) =>
            route.fulfill({ contentType: 'application/javascript', body: '' }),
          );
          for (const [index, id] of fixtureIds.entries()) {
            const fresh = await context.newPage();
            const requests: string[] = [];
            fresh.on('request', (r) => {
              if (r.url().match(/\/(?:media-preview|_emdash\/api\/media)\//))
                requests.push(r.url());
            });
            await fresh.goto(`${baseURL || ''}/?media=${id}#japan-map`);
            const image = fresh.locator('[data-feedback-id="map-preview"] img');
            await expect(image).toBeVisible();
            const measured = await image.evaluate(async (image) => {
              if (!(image instanceof HTMLImageElement))
                throw new Error('Photo required');
              await image.decode();
              const box = image.getBoundingClientRect();
              return {
                width: box.width,
                height: box.height,
                sizes: image.sizes,
                bytes: performance
                  .getEntriesByName(image.currentSrc)
                  .find((entry) => entry instanceof PerformanceResourceTiming)
                  ?.encodedBodySize,
                srcset: image.srcset,
                source: image.src,
                selected: image.currentSrc.match(/\/(\d+)\/auto$/)?.[1],
              };
            });
            const controlContext = await browser.newContext({
              deviceScaleFactor: dpr,
            });
            const controlPage = await controlContext.newPage();
            await controlPage.goto(`${baseURL || ''}/_emdash/api/health`);
            const control = await controlPage.evaluate(
              async ({ srcset, width }) => {
                const image = new Image();
                image.sizes = `${String(width)}px`;
                image.srcset = srcset;
                await image.decode();
                return image.currentSrc.match(/\/(\d+)\/auto$/)?.[1];
              },
              measured,
            );
            await controlContext.close();
            const mapRequests = requestsForPhoto(
              measured.srcset,
              measured.source,
              requests,
            );
            expect(mapRequests).toHaveLength(1);
            expect(
              await fresh.evaluate(
                () => matchMedia('(prefers-color-scheme: dark)').matches,
              ),
            ).toBe(colorScheme === 'dark');
            measurements.push({
              index,
              dpr,
              ...measured,
              control,
              requests: mapRequests,
            });
            if (!measured.selected || !control || measured.selected !== control)
              failures.push({ index, ...measured, control });
            if (evidence)
              await fresh
                .locator('[data-feedback-id="map-preview"]')
                .screenshot({
                  path: `${evidence}/${String(width)}-${String(height)}-${String(dpr)}-${colorScheme}-shape${String(index)}.png`,
                });
            await fresh.close();
          }
          await context.close();
          if (evidence)
            await writeFile(
              `${evidence}/${String(width)}-${String(height)}-${String(dpr)}-${colorScheme}.json`,
              JSON.stringify({ measurements, failures }, null, 2),
            );
          expect(failures).toEqual([]);
        });

test('gallery to viewer to map keeps the first request small, handles late fonts, resize and selection', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 844 },
    deviceScaleFactor: 2,
  });
  await context.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  const page = await context.newPage();
  await page.goto(`${baseURL || ''}/gallery`);
  await page
    .getByRole('link', { name: 'Synthetic portrait', exact: true })
    .click();
  await expect(page.locator('.viewer > img')).toBeVisible();
  const requests: string[] = [];
  let mapNavigation = false;
  page.on('request', (request) => {
    if (
      mapNavigation &&
      request.url().match(/\/(?:media-preview|_emdash\/api\/media)\//)
    )
      requests.push(request.url());
  });
  mapNavigation = true;
  await page.getByRole('link', { name: 'VIEW ON MAP', exact: true }).click();
  const popup = page.locator('[data-feedback-id="map-preview"]');
  const image = popup.locator('img');
  await expect(image).toBeVisible();
  await image.evaluate(async (image) => {
    if (image instanceof HTMLImageElement) await image.decode();
  });
  const photo = await image.evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Photo required');
    return { srcset: image.srcset, source: image.src };
  });
  const mapRequests = requestsForPhoto(photo.srcset, photo.source, requests);
  expect(mapRequests).toHaveLength(1);
  expect(mapRequests[0]).toMatch(/\/800\/auto$/);
  const evidence = process.env.MAP_IMAGE_EVIDENCE_DIR;
  if (evidence)
    await popup.screenshot({ path: `${evidence}/gallery-viewer-map.png` });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1991, height: 1200 },
    { width: 1280, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        image.evaluate((image) => image.getBoundingClientRect().width),
      )
      .toBeCloseTo(
        Math.min(viewport.width - 58, 614, viewport.height * 0.55 * 0.75),
        0,
      );
  }
  for (let index = 0; index < 3; index++) {
    await popup
      .getByRole('button', { name: 'Next media at this location' })
      .click();
    await image.evaluate(async (image) => {
      if (image instanceof HTMLImageElement) await image.decode();
    });
    expect(await image.getAttribute('sizes')).toContain('dvh');
  }
  await popup.getByRole('button', { name: 'Close map preview' }).click();
  await expect(popup).toHaveCount(0);
  await context.close();

  const late = await browser.newContext({
    viewport: { width: 1280, height: 844 },
    deviceScaleFactor: 2,
  });
  await late.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  let release = () => {};
  const fonts = new Promise<void>((resolve) => {
    release = resolve;
  });
  await late.route('**/*.woff2', async (route) => {
    await fonts;
    await route.continue();
  });
  const fresh = await late.newPage();
  const lateRequests: string[] = [];
  fresh.on('request', (r) => {
    if (r.url().match(/\/(?:media-preview|_emdash\/api\/media)\//))
      lateRequests.push(r.url());
  });
  await fresh.goto(`${baseURL || ''}/?media=${fixtureIds[0] || ''}#japan-map`, {
    waitUntil: 'domcontentloaded',
  });
  const lateImage = fresh.locator('[data-feedback-id="map-preview"] img');
  await expect(lateImage).toBeVisible();
  await lateImage.evaluate(async (image) => {
    if (image instanceof HTMLImageElement) await image.decode();
  });
  const latePhoto = await lateImage.evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Photo required');
    return { srcset: image.srcset, source: image.src };
  });
  expect(
    requestsForPhoto(latePhoto.srcset, latePhoto.source, lateRequests),
  ).toHaveLength(1);
  expect(
    requestsForPhoto(latePhoto.srcset, latePhoto.source, lateRequests)[0],
  ).toMatch(/\/800\/auto$/);
  release();
  await fresh.evaluate(() => document.fonts.ready);
  expect(
    requestsForPhoto(latePhoto.srcset, latePhoto.source, lateRequests),
  ).toHaveLength(1);
  await late.close();
});

test.afterAll(async ({ request, baseURL }) => {
  await request.get('/_emdash/api/auth/dev-bypass');
  for (const id of fixtureIds)
    expect(
      (
        await request.delete(`/_emdash/api/content/media_items/${id}`, {
          headers: { 'X-EmDash-Request': '1', Origin: baseURL || '' },
        })
      ).ok(),
    ).toBe(true);
});
