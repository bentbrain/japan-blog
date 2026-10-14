import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';
const run = promisify(execFile);
test.beforeAll(async ({ request }) => {
  await request.post('/_emdash/api/setup/dev-bypass', {
    headers: { 'X-EmDash-Request': '1', Origin: 'http://127.0.0.1:4391' },
    data: {},
  });
  await run('pnpm', ['demo'], {
    env: { ...process.env, TEST_BASE_URL: 'http://127.0.0.1:4391' },
  });
});
test('journal has map first, full text and playable video', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.journal-grid > :first-child')).toHaveClass(
    /journal-map-card/,
  );
  await expect(
    page.getByText(
      'Spent the evening walking through Shinjuku. Stopped for dinner, then kept walking.',
    ),
  ).toBeVisible();
  await expect(page.locator('.post-media video').first()).toHaveAttribute(
    'controls',
    '',
  );
  await page.locator('.map-marker').first().click();
  await expect(page.locator('.map-detail')).toBeVisible();
  expect(
    await page
      .locator('.map-close')
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(26);
  await page.getByRole('button', { name: 'Close map preview' }).click();
  await expect(page.locator('.map-detail')).toBeHidden();
});
test('mobile gallery uses one column and post media scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/gallery');
  const columns = await page
    .locator('.gallery-grid')
    .evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    );
  expect(columns).toBe(1);
  await page.goto('/');
  expect(
    await page
      .locator('.post-media')
      .first()
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('exports require owner auth and PNG has story dimensions', async ({
  page,
}, info) => {
  const denied = await page.request.post('/api/trip/story', {
    data: { day: '2026-10-15', ids: [], counter: 'both' },
  });
  expect(denied.status()).toBe(401);
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/export');
  await page.waitForURL('**/owner/export');
  await expect(page.locator('#story-preview canvas')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT PNG' }).click();
  const file = await download,
    path = info.outputPath('story.png');
  await file.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1920);
});
test('rich editor exposes the published trip media picker', async ({
  page,
}) => {
  await page.goto(
    '/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/posts/new',
  );
  await page.waitForURL('**/content/posts/new');
  await expect(page.locator('.trip-gallery-field')).toBeVisible();
  await expect(page.locator('.trip-gallery-options img').first()).toBeVisible();
});
test('MP4 story export contains a portrait AVC video track', async ({
  page,
}, info) => {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/export');
  await page.waitForURL('**/owner/export');
  await expect(page.locator('#story-preview canvas')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT MP4' }).click();
  const file = await download,
    path = info.outputPath('story.mp4');
  await file.saveAs(path);
  const input = new Input({
    source: new BufferSource(await readFile(path)),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    expect(await track?.getCodec()).toBe('avc');
    expect(await track?.getDisplayWidth()).toBe(1080);
    expect(await track?.getDisplayHeight()).toBe(1920);
    expect(await input.computeDuration()).toBeCloseTo(8);
  } finally {
    input.dispose();
  }
});
