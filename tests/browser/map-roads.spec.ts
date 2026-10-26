import { test, expect, type Route } from '@playwright/test';
import { z } from 'zod';

// Only synthetic public locations and media enter screenshots or tile requests.
test('road context stays aligned through zoom, pan, themes and preview gestures', async ({
  page,
  request,
  baseURL,
  browser,
}) => {
  if (process.env.MAP_ROADS_EVIDENCE && process.env.MAP_ROADS_LIVE !== '1')
    throw new Error('Visual evidence requires live GSI imagery');
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  await request.post('/_emdash/api/setup/dev-bypass', { headers, data: {} });
  await request.get('/_emdash/api/auth/dev-bypass');
  const created = await request.post('/_emdash/api/content/media_items', {
    headers,
    data: {
      slug: `synthetic-road-context-${crypto.randomUUID()}`,
      data: {
        title: 'Synthetic station photo',
        kind: 'photo',
        captured_at: '2099-10-18T12:00:00+09:00',
        latitude: 35.681236,
        longitude: 139.767125,
        place: 'synthetic tokyo station',
        categories: [],
        demo: true,
        source_url: '/demo/japan.jpg',
      },
    },
  });
  expect(created.status()).toBe(201);
  const { item, _rev } = z
    .object({
      data: z.object({
        item: z.object({ id: z.string() }),
        _rev: z.string(),
      }),
    })
    .parse(await created.json()).data;
  expect(
    (
      await request.post(
        `/_emdash/api/content/media_items/${item.id}/publish`,
        {
          headers,
          data: { _rev },
        },
      )
    ).ok(),
  ).toBe(true);
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  let unavailable = false;
  const tileRequests: {
    url: string;
    referer: string | undefined;
    cookie: string | undefined;
  }[] = [];
  async function tileResponse(route: Route) {
    const headers = await route.request().allHeaders();
    tileRequests.push({
      url: route.request().url(),
      referer: headers.referer,
      cookie: headers.cookie,
    });
    if (unavailable) return route.abort('failed');
    if (process.env.MAP_ROADS_LIVE === '1') return route.continue();
    // Deterministic transport fixture. Actual road imagery is separately captured
    // from GSI, never replaced by this image in visual evidence.
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eee"/><text x="20" y="100">synthetic tile</text></svg>',
    });
  }
  await page.route(
    'https://cyberjapandata.gsi.go.jp/xyz/pale/**',
    tileResponse,
  );
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const theme of ['light', 'dark']) {
        await page.goto(`/?media=${item.id}#japan-map`);
        await page.emulateMedia({
          colorScheme: theme === 'dark' ? 'dark' : 'light',
        });
        const map = page.locator('#japan-map');
        await page.getByRole('button', { name: 'Close map preview' }).click();
        const zoomIn = map.getByRole('button', {
          name: 'Zoom in',
          exact: true,
        });
        await expect(zoomIn).toBeEnabled();
        const evidence = process.env.MAP_ROADS_EVIDENCE;
        for (const state of ['country', 'broad', 'regional', 'street']) {
          const target =
            state === 'country'
              ? 0.75
              : state === 'broad'
                ? 3
                : state === 'regional'
                  ? 96
                  : 3072;
          while (Number(await map.getAttribute('data-zoom')) > target)
            await map
              .getByRole('button', { name: 'Zoom out', exact: true })
              .click();
          while (Number(await map.getAttribute('data-zoom')) < target)
            await zoomIn.click();
          if (state === 'country' || state === 'broad') {
            await expect(map.locator('[data-map-tile]')).toHaveCount(0);
          } else {
            const tiles = map.locator('[data-map-tile]');
            await expect(tiles.first()).toBeVisible();
            expect(await tiles.count()).toBeLessThanOrEqual(24);
            await expect
              .poll(() =>
                tiles.evaluateAll((images) =>
                  images.every(
                    (image) =>
                      image instanceof HTMLImageElement &&
                      image.complete &&
                      image.naturalWidth > 0,
                  ),
                ),
              )
              .toBe(true);
            await expect(
              map.getByRole('link', {
                name: 'Map source: GSI Japan, colours adjusted',
              }),
            ).toBeVisible();
            const marker = map.getByRole('button', {
              name: 'synthetic tokyo station, 1 items',
              exact: true,
            });
            const markerBox = await marker.boundingBox();
            if (!markerBox)
              throw new Error('Synthetic station marker required');
            const aligned = await tiles.evaluateAll((images) =>
              images.some((image) => {
                const [level, x, y] = (
                  image.getAttribute('data-map-tile') || ''
                )
                  .split('/')
                  .map(Number);
                if (level === undefined || x === undefined || y === undefined)
                  return false;
                const east = ((139.767125 + 180) / 360) * 2 ** level;
                const north =
                  ((1 -
                    Math.asinh(Math.tan((35.681236 * Math.PI) / 180)) /
                      Math.PI) /
                    2) *
                  2 ** level;
                if (x !== Math.floor(east) || y !== Math.floor(north))
                  return false;
                const box = image.getBoundingClientRect();
                const map = image
                  .closest('#japan-map')
                  ?.getBoundingClientRect();
                return (
                  map &&
                  Math.abs(
                    box.x +
                      (east % 1) * (box.width - 0.5) -
                      (map.x + map.width / 2),
                  ) < 1 &&
                  Math.abs(
                    box.y +
                      (north % 1) * (box.height - 0.5) -
                      (map.y + map.height / 2),
                  ) < 1
                );
              }),
            );
            expect(
              aligned,
              'Road imagery must align with the independently calculated station position',
            ).toBe(true);
          }
          if (evidence) {
            await page.waitForTimeout(1500);
            await map.screenshot({
              path: `${evidence}-${String(width)}-${theme}-${state}.png`,
            });
          }
        }
        const svg = map.getByRole('group', { name: 'Japan media map' });
        const marker = map.getByRole('button', {
          name: 'synthetic tokyo station, 1 items',
          exact: true,
        });
        const beforePan = await marker.boundingBox();
        const bounds = await map.boundingBox();
        if (!beforePan || !bounds) throw new Error('Map bounds required');
        await page.mouse.move(bounds.x + 90, bounds.y + 90);
        await page.mouse.down();
        await page.mouse.move(bounds.x + 150, bounds.y + 120, { steps: 5 });
        await page.mouse.up();
        expect(
          await page.evaluate(() => window.getSelection()?.toString()),
        ).toBe('');
        const afterPan = await marker.boundingBox();
        expect(afterPan?.x).toBeCloseTo(beforePan.x + 60, 0);
        expect(afterPan?.y).toBeCloseTo(beforePan.y + 30, 0);
        await expect(svg).toBeFocused();
        await marker.click();
        await expect(
          page.locator('[data-feedback-id="map-preview"]'),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Close map preview' }).click();
      }
    }
    expect(tileRequests.length).toBeGreaterThan(0);
    for (const request of tileRequests) {
      expect(request.referer).toBeUndefined();
      expect(request.cookie).toBeUndefined();
      expect(request.url).toMatch(
        /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/\d+\/\d+\/\d+\.png$/,
      );
    }
    // A fresh image cache makes the outage exercise actual failed requests,
    // rather than Chromium reusing decoded tiles from the successful cases.
    const context = await browser.newContext({ baseURL });
    await context.route('https://toolbar.bent.build/embed.js', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: '' }),
    );
    await context.route(
      'https://cyberjapandata.gsi.go.jp/xyz/pale/**',
      tileResponse,
    );
    const fresh = await context.newPage();
    try {
      unavailable = true;
      await fresh.goto(`/?media=${item.id}#japan-map`);
      await fresh.getByRole('button', { name: 'Close map preview' }).click();
      const map = fresh.locator('#japan-map');
      while (Number(await map.getAttribute('data-zoom')) < 96)
        await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect(map.getByRole('status')).toHaveText(
        'street map unavailable',
      );
      await expect(
        map.getByRole('button', {
          name: 'synthetic tokyo station, 1 items',
          exact: true,
        }),
      ).toBeVisible();
      unavailable = false;
      await map.getByRole('button', { name: 'RETRY', exact: true }).click();
      await expect(map.getByRole('status')).toHaveCount(0);
      await expect
        .poll(() =>
          map
            .locator('[data-map-tile]')
            .evaluateAll(
              (images) =>
                images.length > 0 &&
                images.every(
                  (image) =>
                    image instanceof HTMLImageElement &&
                    image.complete &&
                    image.naturalWidth > 0,
                ),
            ),
        )
        .toBe(true);
      await map
        .getByRole('button', { name: 'Fit all media', exact: true })
        .click();
      await expect(map.locator('[data-map-tile]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    expect(
      (
        await request.delete(`/_emdash/api/content/media_items/${item.id}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
  }
});
