import { test, expect } from '@playwright/test';

test('map controls zoom, fit and retain geographic context on desktop and mobile', async ({
  page,
  request,
  baseURL,
}) => {
  await request.post('/_emdash/api/setup/dev-bypass', {
    headers: { 'X-EmDash-Request': '1', Origin: baseURL ?? '' },
    data: {},
  });
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  await page.goto('/');
  const map = page.locator('#japan-map');
  const zoomIn = map.getByRole('button', { name: 'Zoom in', exact: true });
  const zoomOut = map.getByRole('button', { name: 'Zoom out', exact: true });
  const fit = map.getByRole('button', { name: 'Fit all media', exact: true });
  await expect(zoomIn).toBeEnabled();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await fit.click();
    const initial = Number(await map.getAttribute('data-zoom'));
    await zoomIn.click();
    await expect(map).toHaveAttribute('data-zoom', String(initial * 2));
    await zoomOut.click();
    await expect(map).toHaveAttribute('data-zoom', String(initial));
    await zoomIn.focus();
    await page.keyboard.press('Enter');
    await expect(map).toHaveAttribute('data-zoom', String(initial * 2));
    await fit.click();
    await expect(map).toHaveAttribute('data-zoom', String(initial));
    const svg = map.getByRole('group', { name: 'Japan media map' });
    await svg.dispatchEvent('wheel', {
      deltaY: -120,
      ctrlKey: true,
      clientX: 200,
      clientY: 250,
    });
    await expect
      .poll(async () => Number(await map.getAttribute('data-zoom')))
      .toBeGreaterThan(initial);
    await fit.click();
    await svg.dispatchEvent('wheel', {
      deltaY: -120,
      clientX: 200,
      clientY: 250,
    });
    await expect(map).toHaveAttribute('data-zoom', String(initial));
    for (let index = 0; index < 8 && (await zoomOut.isEnabled()); index++)
      await zoomOut.click();
    await expect(zoomOut).toBeDisabled();
    await fit.click();
    await expect(map.locator('[data-map-context]')).not.toHaveCount(0);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
  }
});
