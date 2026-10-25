import { test, expect } from '@playwright/test';

test('map controls retain zoom and geographic context without the location button', async ({
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
  await expect(zoomIn).toBeEnabled();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    await expect(zoomIn).toBeEnabled();
    await expect(
      map.getByRole('group', { name: 'Map controls' }).getByRole('button'),
    ).toHaveCount(2);
    const initial = Number(await map.getAttribute('data-zoom'));
    await zoomIn.click();
    await expect(map).toHaveAttribute('data-zoom', String(initial * 2));
    await zoomOut.click();
    await expect(map).toHaveAttribute('data-zoom', String(initial));
    await zoomIn.focus();
    await page.keyboard.press('Enter');
    await expect(map).toHaveAttribute('data-zoom', String(initial * 2));
    await zoomOut.click();
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
    const afterWheel = await map.getAttribute('data-zoom');
    await svg.dispatchEvent('wheel', {
      deltaY: -120,
      clientX: 200,
      clientY: 250,
    });
    await expect(map).toHaveAttribute('data-zoom', afterWheel ?? '');
    await svg.dispatchEvent('wheel', {
      deltaY: 120,
      ctrlKey: true,
      clientX: 200,
      clientY: 250,
    });
    await expect(map.locator('[data-map-context]')).not.toHaveCount(0);
    await svg.focus();
    await page.keyboard.press('+');
    await expect(map).toHaveAttribute('data-zoom', String(initial * 2));
    await page.keyboard.press('-');
    await expect(map).toHaveAttribute('data-zoom', String(initial));
    const land = svg.locator('path').first();
    const beforePan = await land.getAttribute('transform');
    await page.keyboard.press('ArrowRight');
    await expect(land).not.toHaveAttribute('transform', beforePan ?? '');
    for (let index = 0; index < 8 && (await zoomOut.isEnabled()); index++)
      await zoomOut.click();
    await expect(zoomOut).toBeDisabled();
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
  }
});
