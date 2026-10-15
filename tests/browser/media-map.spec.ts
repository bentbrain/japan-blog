import { test, expect } from '@playwright/test';
import { z } from 'zod';

test('CMS media links and map previews work for locations outside Japan', async ({
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
  const slug = `synthetic-map-${crypto.randomUUID()}`;
  const created = await request.post('/_emdash/api/content/media_items', {
    headers,
    data: {
      slug,
      data: {
        title: 'Synthetic outside Japan photo',
        kind: 'photo',
        captured_at: '2099-10-15T12:00:00+09:00',
        latitude: -27.47,
        longitude: 153.02,
        place: 'synthetic outside Japan',
        categories: [],
        demo: true,
        source_url: '/demo/japan.jpg',
      },
    },
  });
  expect(created.status()).toBe(201);
  const { item, _rev } = z
    .object({
      data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
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
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/media_items/${slug}`);
    await expect(page).toHaveURL(new RegExp(`/media/${slug}$`));
    await page.getByRole('link', { name: 'VIEW ON MAP', exact: true }).click();
    const marker = page.getByRole('button', {
      name: 'synthetic outside Japan, 1 items',
      exact: true,
    });
    await expect(marker).toBeEnabled();
    const inside = await marker.evaluate((element) => {
      const bounds = element.closest('#japan-map')?.getBoundingClientRect();
      const pin = element.getBoundingClientRect();
      return (
        bounds &&
        pin.left >= bounds.left &&
        pin.top >= bounds.top &&
        pin.right <= bounds.right &&
        pin.bottom <= bounds.bottom
      );
    });
    expect(inside, 'Map marker is clipped outside the map').toBe(true);
    const preview = page.locator('[data-feedback-id="map-preview"]');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('img')).toBeVisible();
    await page.getByRole('button', { name: 'Close map preview' }).click();
    await marker.click();
    await preview.getByRole('link', { name: 'VIEW MEDIA' }).click();
    await expect(page).toHaveURL(new RegExp(`/media/${slug}$`));
  }
});
