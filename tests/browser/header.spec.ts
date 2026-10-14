import { test, expect } from '@playwright/test';

for (const width of [390, 1280, 1778]) {
  test(`header matches shop typography and height at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const header = page.locator('.site-header');
    await expect(header).toHaveCSS('font-size', '11.2px');
    await expect(header).toHaveCSS('font-weight', '700');
    await expect(header).toHaveCSS('line-height', '16.8px');
    await expect(header).toHaveCSS('letter-spacing', '0.56px');
    expect(
      await header.evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(48);
    await expect(
      page.getByRole('link', { name: 'journal', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'gallery', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await expect(page.locator('body')).toHaveCSS('font-size', '13px');
  });
}

for (const width of [390, 1280]) {
  test(`beer icon matches the lowercase x-height and baseline at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.locator('.beer').evaluate((counter) => {
      const icon = counter.querySelector('svg');
      const path = counter.querySelector('path');
      const label = counter.querySelector('span');
      if (
        !(icon instanceof SVGSVGElement) ||
        !(path instanceof SVGGraphicsElement) ||
        !label
      )
        throw new Error('Beer icon and label required');
      const style = getComputedStyle(label);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Font measurement context required');
      context.font = style.font;
      const x = context.measureText('x');
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0';
      label.append(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const bounds = path.getBBox();
      const transform = path.getScreenCTM();
      if (!transform) throw new Error('Rendered SVG transform required');
      const top = new DOMPoint(bounds.x, bounds.y).matrixTransform(transform).y;
      const bottom = new DOMPoint(
        bounds.x,
        bounds.y + bounds.height,
      ).matrixTransform(transform).y;
      return {
        height: bottom - top,
        xHeight: x.actualBoundingBoxAscent,
        bottom,
        baseline,
      };
    });
    expect(Math.abs(metrics.height - metrics.xHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.bottom - metrics.baseline)).toBeLessThanOrEqual(1);
  });
}

for (const owner of [false, true]) {
  test(`${owner ? 'owner' : 'public'} navigation wraps on narrow screens without overflow`, async ({
    page,
    baseURL,
  }) => {
    if (owner) {
      const setup = await page.request.post('/_emdash/api/setup/dev-bypass', {
        headers: { 'X-EmDash-Request': '1', Origin: baseURL ?? '' },
        data: {},
      });
      expect(setup.ok()).toBe(true);
      await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner');
      await page.waitForURL('**/owner');
    } else {
      await page.goto('/');
    }
    await page.setViewportSize({ width: 320, height: 844 });
    const navigation = page.getByRole('navigation', {
      name: 'Main navigation',
    });
    await expect(navigation).toBeVisible();
    for (const name of owner
      ? ['posts', 'media', 'export']
      : ['journal', 'gallery'])
      await expect(
        navigation.getByRole('link', { name, exact: true }),
      ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    expect(
      await page
        .locator('.site-header')
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThan(48);
  });
}
