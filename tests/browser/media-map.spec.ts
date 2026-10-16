import { test, expect } from '@playwright/test';
import { z } from 'zod';

test('map previews include Japan while outside media stays in the gallery and posts', async ({
  page,
  request,
  baseURL,
}) => {
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  expect(
    (
      await request.post('/_emdash/api/setup/dev-bypass', { headers, data: {} })
    ).ok(),
  ).toBe(true);
  await request.get('/_emdash/api/auth/dev-bypass');
  const fixtures = [];
  for (const [place, latitude, longitude] of [
    ['okinawa', 26.2124, 127.6809],
    ['brisbane', -27.47, 153.02],
    ['airplane', 5, 145],
  ] satisfies [string, number, number][]) {
    const slug = `synthetic-map-${crypto.randomUUID()}`;
    const title = `Synthetic ${place} photo`;
    const created = await request.post('/_emdash/api/content/media_items', {
      headers,
      data: {
        slug,
        data: {
          title,
          kind: 'photo',
          captured_at: '2099-10-15T12:00:00+09:00',
          latitude,
          longitude,
          place: `synthetic ${place}`,
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
          { headers, data: { _rev } },
        )
      ).ok(),
    ).toBe(true);
    fixtures.push({ id: item.id, slug, title, place });
  }
  const japan = fixtures.find((item) => item.place === 'okinawa');
  if (!japan) throw new Error('Japan map fixture required');
  const postSlug = `synthetic-map-post-${crypto.randomUUID()}`;
  const post = await request.post('/_emdash/api/content/posts', {
    headers,
    data: {
      slug: postSlug,
      data: {
        title: 'Synthetic map post',
        day: '2099-10-15',
        content: [],
        gallery: fixtures.map((item) => item.id),
        demo: true,
      },
    },
  });
  expect(post.status()).toBe(201);
  const { item: postItem, _rev: postRev } = z
    .object({
      data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
    })
    .parse(await post.json()).data;
  expect(
    (
      await request.post(`/_emdash/api/content/posts/${postItem.id}/publish`, {
        headers,
        data: { _rev: postRev },
      })
    ).ok(),
  ).toBe(true);
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  // Check the server response as well as hydrated markers and deep links.
  const html = await (await request.get('/')).text();
  const mapMarkup = html.match(
    /<astro-island\b[^>]*component-export="JapanMapView"[\s\S]*?<\/astro-island>/,
  )?.[0];
  expect(mapMarkup).toBeTruthy();
  expect(mapMarkup).toContain('synthetic okinawa');
  expect(mapMarkup).not.toContain('synthetic brisbane');
  expect(mapMarkup).not.toContain('synthetic airplane');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const fixture of fixtures) {
      await page.goto(`/media_items/${fixture.slug}`);
      await expect(page).toHaveURL(new RegExp(`/media/${fixture.slug}$`));
      await expect(
        page.getByRole('img', { name: fixture.title }),
      ).toBeVisible();
      const mapLink = page.getByRole('link', {
        name: 'VIEW ON MAP',
        exact: true,
      });
      if (fixture.place === 'okinawa') {
        await mapLink.click();
      } else {
        await expect(mapLink).toHaveCount(0);
        await page.goto(`/?media=${fixture.id}#japan-map`);
        await expect(
          page.locator('[data-feedback-id="map-preview"]'),
        ).toHaveCount(0);
      }
      await expect(
        page.getByRole('button', { name: /synthetic brisbane/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /synthetic airplane/ }),
      ).toHaveCount(0);
    }
    await page.goto(`/media/${japan.slug}`);
    await page.getByRole('link', { name: 'VIEW ON MAP', exact: true }).click();
    const marker = page.getByRole('button', {
      name: 'synthetic okinawa, 1 items',
      exact: true,
    });
    await expect(marker).toBeEnabled();
    expect(
      await marker.evaluate((element) => {
        const bounds = element.closest('#japan-map')?.getBoundingClientRect();
        const pin = element.getBoundingClientRect();
        return (
          bounds &&
          pin.left >= bounds.left &&
          pin.top >= bounds.top &&
          pin.right <= bounds.right &&
          pin.bottom <= bounds.bottom
        );
      }),
      'Map marker is clipped outside the map',
    ).toBe(true);
    const preview = page.locator('[data-feedback-id="map-preview"]');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('img')).toBeVisible();
    await page.getByRole('button', { name: 'Close map preview' }).click();
    await marker.click();
    await preview.getByRole('link', { name: 'VIEW MEDIA' }).click();
    await expect(page).toHaveURL(new RegExp(`/media/${japan.slug}$`));
    for (const route of ['/gallery', `/posts/${postSlug}`]) {
      await page.goto(route);
      for (const fixture of fixtures)
        await expect(
          page.getByRole('img', { name: fixture.title }),
        ).toHaveCount(1);
    }
  }
});
