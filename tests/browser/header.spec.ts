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
