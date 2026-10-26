import { test, expect } from '@playwright/test';
import { z } from 'zod';

// Only synthetic locations and media enter screenshots.
test('map has no highway overlay through zoom, pan, themes and preview gestures', async ({
  page,
  request,
  baseURL,
}) => {
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
  // Match the shared suite's nearby gallery fixture even in an isolated run.
  // It must cluster at country/broad zoom and split at regional/street zoom.
  const nearby = await request.post('/_emdash/api/content/media_items', {
    headers,
    data: {
      slug: `synthetic-road-nearby-${crypto.randomUUID()}`,
      data: {
        title: 'Synthetic nearby photo',
        kind: 'photo',
        captured_at: '2099-10-15T12:00:00+09:00',
        latitude: 35.6895,
        longitude: 139.6917,
        place: 'synthetic nearby tokyo',
        categories: [],
        demo: true,
        source_url: '/demo/japan.jpg',
      },
    },
  });
  expect(nearby.status()).toBe(201);
  const nearbyRecord = z
    .object({
      data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
    })
    .parse(await nearby.json()).data;
  expect(
    (
      await request.post(
        `/_emdash/api/content/media_items/${nearbyRecord.item.id}/publish`,
        { headers, data: { _rev: nearbyRecord._rev } },
      )
    ).ok(),
  ).toBe(true);
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  const tileRequests: string[] = [];
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) => {
    tileRequests.push(route.request().url());
    return route.abort();
  });
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
          await expect(
            map.locator('[data-map-roads], [data-map-tile]'),
          ).toHaveCount(0);
          await expect(
            map.getByRole('link', {
              name: 'Map source: GSI Japan, colours adjusted',
            }),
          ).toHaveCount(0);
          await expect(map.getByRole('status')).toHaveCount(0);
          await expect(map.locator('svg > path').first()).toHaveAttribute(
            'd',
            /M.+/,
          );
          if (state === 'country')
            await expect(
              map.locator('[data-map-context="island"]').first(),
            ).toBeVisible();
          // At regional zoom, nearby media can correctly suppress Tokyo's
          // reference label to avoid overlap. Check city context at broad zoom.
          if (state === 'broad')
            await expect(
              map.locator('[data-map-context="city"]').first(),
            ).toBeVisible();
          await expect(
            map.getByRole('button', {
              name:
                state === 'country' || state === 'broad'
                  ? /^synthetic tokyo station, (?:[2-9]|[1-9]\d+) items$/
                  : 'synthetic tokyo station, 1 items',
              exact: true,
            }),
          ).toBeVisible();
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
        const preview = page.locator('[data-feedback-id="map-preview"]');
        await expect(preview).toBeVisible();
        await expect(preview.getByRole('heading')).toHaveText(
          'synthetic tokyo station / 1 of 1',
        );
        await page.getByRole('button', { name: 'Close map preview' }).click();
      }
    }
    expect(tileRequests).toEqual([]);
  } finally {
    for (const id of [item.id, nearbyRecord.item.id])
      expect(
        (
          await request.delete(`/_emdash/api/content/media_items/${id}`, {
            headers,
          })
        ).ok(),
      ).toBe(true);
  }
});

test('private GPS revisions never request external tiles in edit mode or native preview', async ({
  page,
  baseURL,
}) => {
  const api = page.request;
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  await api.post('/_emdash/api/setup/dev-bypass', { headers, data: {} });
  await api.get('/_emdash/api/auth/dev-bypass');
  const response = await api.post('/_emdash/api/content/media_items', {
    headers,
    data: {
      slug: `synthetic-private-roads-${crypto.randomUUID()}`,
      data: {
        title: 'Synthetic private road location',
        kind: 'photo',
        captured_at: '2099-10-18T12:00:00+09:00',
        latitude: 35.681236,
        longitude: 139.767125,
        place: 'synthetic live tokyo',
        categories: [],
        demo: true,
        source_url: '/demo/japan.jpg',
      },
    },
  });
  expect(response.status()).toBe(201);
  const record = z.object({
    data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
  });
  const { item, _rev } = record.parse(await response.json()).data;
  const path = `/_emdash/api/content/media_items/${item.id}`;
  try {
    expect(
      (await api.post(`${path}/publish`, { headers, data: { _rev } })).ok(),
    ).toBe(true);
    const live = record.parse(await (await api.get(path)).json()).data;
    expect(
      (
        await api.put(path, {
          headers,
          data: {
            _rev: live._rev,
            data: {
              latitude: 43.0618,
              longitude: 141.3545,
              place: 'synthetic unpublished sapporo',
            },
          },
        })
      ).ok(),
    ).toBe(true);
    const preview = await api.post(`${path}/preview-url`, {
      headers,
      data: {},
    });
    expect(preview.ok()).toBe(true);
    const previewUrl = z
      .object({ data: z.object({ url: z.string() }) })
      .parse(await preview.json()).data.url;
    const query = new URL(previewUrl, baseURL).searchParams;
    const tileRequests: string[] = [];
    await page.route('https://toolbar.bent.build/embed.js', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: '' }),
    );
    await page.route('https://cyberjapandata.gsi.go.jp/**', (route) => {
      tileRequests.push(route.request().url());
      return route.abort();
    });
    for (const mode of ['edit', 'preview']) {
      await page.context().addCookies([
        {
          name: 'emdash-edit-mode',
          value: mode === 'edit' ? 'true' : 'false',
          url: baseURL ?? 'http://127.0.0.1:4391',
        },
      ]);
      const search =
        mode === 'preview' ? new URLSearchParams(query) : new URLSearchParams();
      search.set('media', item.id);
      await page.goto(`/?${search.toString()}#japan-map`);
      const map = page.locator('#japan-map');
      await expect(
        page.locator('[data-feedback-id="map-preview"]'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Close map preview' }).click();
      const marker = map.getByRole('button', {
        name: 'synthetic unpublished sapporo, 1 items',
        exact: true,
      });
      await expect(marker).toBeVisible();
      const zoom = map.getByRole('button', { name: 'Zoom in', exact: true });
      while (Number(await map.getAttribute('data-zoom')) < 3072)
        await zoom.click();
      await expect(marker).toBeVisible();
      await expect(map.locator('[data-map-tile]')).toHaveCount(0);
      await marker.click();
      await expect(
        page.locator('[data-feedback-id="map-preview"]'),
      ).toBeVisible();
      expect(tileRequests).toEqual([]);
    }
  } finally {
    expect((await api.delete(path, { headers })).ok()).toBe(true);
  }
});
