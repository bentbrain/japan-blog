import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';
import { z } from 'zod';
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
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/posts/new');
  await page.waitForURL('**/owner/posts/new');
  await page.getByRole('button', { name: '+ MEDIA', exact: true }).click();
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

test('owner writes and publishes rich text through the shadcn editor', async ({
  page,
}) => {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/posts/new');
  await page.waitForURL('**/owner/posts/new');
  await page.getByLabel('title', { exact: true }).fill('Browser post');
  await page
    .getByRole('textbox', { name: 'Post content' })
    .fill('A real published paragraph.');
  await page.getByRole('textbox', { name: 'Post content' }).press('Enter');
  await page.getByRole('textbox', { name: 'Post content' }).press('Enter');
  await page.keyboard.type('After the blank paragraph.');
  await page.getByRole('button', { name: 'PUBLISH', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('published');
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'Post content' }),
  ).toContainText('After the blank paragraph.');
  await expect(
    page.getByRole('textbox', { name: 'Post content' }).locator('p'),
  ).toHaveCount(3);
  await page.goto('/');
  await expect(page.getByText('A real published paragraph.')).toBeVisible();
});

test('draft posts stay available to the owner and hidden from the journal', async ({
  page,
}) => {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/posts/new');
  await page.waitForURL('**/owner/posts/new');
  await page
    .getByLabel('title', { exact: true })
    .fill('Unpublished browser draft');
  await page
    .getByRole('textbox', { name: 'Post content' })
    .fill('Private draft paragraph.');
  await page.getByRole('button', { name: 'SAVE DRAFT', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('draft saved');
  await page.goto('/owner');
  await expect(
    page.getByRole('row').filter({ hasText: 'Unpublished browser draft' }),
  ).toContainText('draft');
  await page.goto('/');
  await expect(page.getByText('Private draft paragraph.')).toBeHidden();
});

test('a delayed save keeps newer edits unsaved', async ({ page }) => {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/posts/new');
  await page.waitForURL('**/owner/posts/new');
  await page.getByLabel('title', { exact: true }).fill('Delayed save');
  const editor = page.getByRole('textbox', { name: 'Post content' });
  await editor.fill('Submitted text');
  let releaseResponse = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/trip/posts', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'SAVE DRAFT', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'SAVE DRAFT', exact: true }),
  ).toBeDisabled();
  await editor.fill('Newer unsaved text');
  releaseResponse();
  await expect(
    page.getByRole('button', { name: 'SAVE DRAFT', exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await expect(page.getByRole('status')).toContainText('newer edits unsaved');
  await page.unroute('**/api/trip/posts');
  await page.getByRole('button', { name: 'SAVE DRAFT', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('draft saved');
  await page.reload();
  await expect(editor).toHaveText('Newer unsaved text');
});

test('owner uploads a photo and publishes it with manual GPS and categories', async ({
  page,
}) => {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/media');
  await page.waitForURL('**/owner/media');
  await expect(
    page.getByRole('button', { name: 'UPLOAD', exact: true }),
  ).toBeEnabled();
  await page.locator('#upload').setInputFiles('public/demo/japan.jpg');
  await expect(page.locator('#upload-status')).toHaveText('uploaded', {
    timeout: 30_000,
  });
  await expect(page.locator('#metadata')).toBeVisible();
  await page.getByLabel('title', { exact: true }).fill('Browser upload photo');
  await page.getByLabel('captured in japan').fill('2026-10-15T20:15');
  await page.getByLabel('latitude', { exact: true }).fill('35.6895');
  await page.getByLabel('longitude', { exact: true }).fill('139.6917');
  await page.getByRole('checkbox', { name: 'food', exact: true }).check();
  await page.getByLabel('other categories').fill('ramen');
  await page.getByRole('checkbox', { name: 'public', exact: true }).check();
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('saved');
  await page.goto('/gallery?category=ramen');
  await expect(
    page.getByRole('img', { name: 'Browser upload photo', exact: true }),
  ).toBeVisible();
  await page.goto('/owner/posts/new');
  await page.getByLabel('title', { exact: true }).fill('Photo publication');
  await page.getByRole('textbox', { name: 'Post content' }).fill('Dinner');
  await page.getByRole('button', { name: 'LIST', exact: true }).click();
  await page.getByRole('button', { name: '+ MEDIA', exact: true }).click();
  const uploadedTile = page.locator('.trip-gallery-options > div').filter({
    has: page.getByRole('img', { name: 'Browser upload photo', exact: true }),
  });
  await uploadedTile
    .getByRole('button', { name: 'INSERT IN POST', exact: true })
    .click();
  await expect(page.locator('.tiptap img')).toHaveAttribute(
    'src',
    /^\/_emdash\/api\/media\/file\/trip\//,
  );
  await expect(page.locator('.tiptap li img')).toHaveCount(0);
  await expect(page.locator('.tiptap > img')).toHaveCount(1);
  await page.getByRole('button', { name: 'PUBLISH', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('published');
  await page.goto('/');
  await expect(
    page
      .locator('article')
      .filter({ hasText: 'Photo publication' })
      .getByRole('img', { name: 'Browser upload photo', exact: true }),
  ).toBeVisible();
});

test('category-only edits retain capture seconds and milliseconds', async ({
  page,
}) => {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/media');
  await page.waitForURL('**/owner/media');
  await expect(
    page.getByRole('button', { name: 'UPLOAD', exact: true }),
  ).toBeEnabled();
  const captured = '2026-10-15T11:15:42.123Z';
  const created = await page.request.post('/_emdash/api/content/media_items', {
    headers: { 'X-EmDash-Request': '1', Origin: 'http://127.0.0.1:4391' },
    data: {
      slug: `capture-precision-${crypto.randomUUID()}`,
      data: {
        title: 'Capture precision',
        kind: 'photo',
        captured_at: captured,
        latitude: 35.6895,
        longitude: 139.6917,
        categories: ['food'],
        source_url: '/demo/japan.jpg',
      },
    },
  });
  expect(created.ok()).toBe(true);
  const id = z
    .object({ data: z.object({ item: z.object({ id: z.string() }) }) })
    .parse(await created.json()).data.item.id;
  await page.reload();
  await page
    .getByRole('button', { name: 'Capture precision, draft', exact: true })
    .click();
  await page.getByRole('checkbox', { name: 'shopping', exact: true }).check();
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('saved');
  const saved = await page.request.get(
    `/_emdash/api/content/media_items/${id}`,
  );
  const metadata = z
    .object({
      data: z.object({
        item: z.object({
          data: z.object({
            captured_at: z.string(),
            categories: z.array(z.string()),
          }),
        }),
      }),
    })
    .parse(await saved.json()).data.item.data;
  expect(metadata.categories).toContain('shopping');
  expect(metadata.captured_at).toBe(captured);
  await page.getByLabel('captured in japan').fill('2026-10-16T00:01:07.456');
  const secondSave = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/trip/media') &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await secondSave;
  await expect(page.locator('#save-status')).toHaveText('saved');
  const edited = await page.request.get(
    `/_emdash/api/content/media_items/${id}`,
  );
  expect(
    z
      .object({
        data: z.object({
          item: z.object({ data: z.object({ captured_at: z.string() }) }),
        }),
      })
      .parse(await edited.json()).data.item.data.captured_at,
  ).toBe('2026-10-15T15:01:07.456Z');
});

test('cancelling PNG export during loading or saving prevents a download', async ({
  page,
}) => {
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/export');
  await page.waitForURL('**/owner/export');
  await expect(page.locator('#story-preview canvas')).toBeVisible();
  let downloads = 0;
  page.on('download', () => {
    downloads++;
  });
  for (const phase of ['loading', 'saving']) {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pattern =
      phase === 'loading' ? '**/demo/*.jpg' : '**/api/trip/exports';
    await page.route(pattern, async (route) => {
      await gate;
      await route.continue().catch(() => {});
    });
    const pending = page.waitForRequest(
      phase === 'loading' ? /\/demo\/.*\.jpg/ : /\/api\/trip\/exports$/,
    );
    await page.getByRole('button', { name: 'EXPORT PNG', exact: true }).click();
    await pending;
    await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
    release();
    await expect(page.locator('#export-status')).toHaveText('cancelled');
    expect(downloads).toBe(0);
    await expect(page.locator('#download')).toHaveCount(0);
    await page.unroute(pattern);
  }
});
