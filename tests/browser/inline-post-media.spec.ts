import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { encode } from 'fast-png';

const savedPost = z.object({ post: z.object({ id: z.string() }) });

test('post-only photos stay private until publication and never enter the trip gallery', async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/posts/new');
  await page.waitForURL('**/owner/posts/new');
  await page
    .getByLabel('title', { exact: true })
    .fill('Sample inline illustration');
  await page
    .getByRole('textbox', { name: 'Post content' })
    .fill('Sample story');
  await page.getByRole('button', { name: '+ MEDIA', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  if (process.env.INLINE_SCREENSHOT) {
    await page.waitForTimeout(1000);
    await page.screenshot({ path: process.env.INLINE_SCREENSHOT });
  }
  const firstUpload = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/trip/upload') &&
      response.request().method() === 'POST',
  );
  const graphic = Buffer.from(
    encode({
      width: 160,
      height: 80,
      channels: 3,
      data: new Uint8Array(160 * 80 * 3).fill(80),
    }),
  );
  await page.getByLabel('post-only photo', { exact: true }).setInputFiles({
    name: 'sample-graphic.png',
    mimeType: 'image/png',
    buffer: graphic,
  });
  const { asset, sourceUrl } = z
    .object({
      asset: z.object({ id: z.string(), url: z.string() }),
      sourceUrl: z.string(),
    })
    .parse(await (await firstUpload).json());
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
  const image = page.locator('.tiptap > img');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (image) => image instanceof HTMLImageElement && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const src = await image.getAttribute('src');
  if (!src) throw new Error('Inline image URL required');
  expect(src).toMatch(/^\/_emdash\/api\/media\/asset\//);
  expect(src).toBe(asset.url);
  const anonymous = await browser.newContext();
  try {
    const publicRequest = anonymous.request;
    expect(
      (await publicRequest.get(`http://127.0.0.1:4391${sourceUrl}`)).status(),
    ).toBe(404);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/trip/posts') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'SAVE DRAFT', exact: true }).click();
    const id = savedPost.parse(await (await saved).json()).post.id;
    await expect(page.getByRole('status')).toHaveText('draft saved');
    await page.reload();
    await expect(page.locator('.tiptap > img')).toHaveAttribute('src', src);
    expect(
      (await publicRequest.get(`http://127.0.0.1:4391${sourceUrl}`)).status(),
    ).toBe(404);
    await page.getByRole('button', { name: 'PUBLISH', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('published');
    expect(
      (await publicRequest.get(`http://127.0.0.1:4391${sourceUrl}`)).status(),
    ).toBe(200);
    const uploadFolder = sourceUrl.split('/')[6];
    if (!uploadFolder) throw new Error('Post-only display path required');
    expect(
      (
        await publicRequest.get(
          `http://127.0.0.1:4391/_emdash/api/media/file/trip-private/originals/${uploadFolder}`,
        )
      ).status(),
    ).toBe(404);
    const publicPage = await anonymous.newPage();
    expect((await publicPage.goto('http://127.0.0.1:4391/'))?.status()).toBe(
      200,
    );
    await expect(
      publicPage
        .locator('article')
        .filter({ hasText: 'Sample inline illustration' })
        .locator('img')
        .first(),
    ).toBeVisible();
    await expect
      .poll(() =>
        publicPage
          .locator('article img')
          .first()
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    const library = await page.request.get('/api/trip/media');
    expect(JSON.stringify(await library.json())).not.toContain('trip-inline/');
    await publicPage.goto('http://127.0.0.1:4391/gallery');
    await expect(publicPage.locator(`img[src="${sourceUrl}"]`)).toHaveCount(0);
    // Staged post edits cannot grant access to other uploaded assets.
    await page.getByRole('button', { name: '+ MEDIA', exact: true }).click();
    const stagedUpload = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/trip/upload') &&
        response.request().method() === 'POST',
    );
    await page
      .getByLabel('post-only photo', { exact: true })
      .setInputFiles('public/demo/japan.jpg');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    const stagedSrc = z
      .object({ sourceUrl: z.string() })
      .parse(await (await stagedUpload).json()).sourceUrl;
    expect(stagedSrc).not.toBe(sourceUrl);
    await page.getByRole('button', { name: 'SAVE DRAFT', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('draft saved');
    expect(
      (await publicRequest.get(`http://127.0.0.1:4391${stagedSrc}`)).status(),
    ).toBe(404);
    expect(
      (await publicRequest.get(`http://127.0.0.1:4391${sourceUrl}`)).status(),
    ).toBe(200);
    // Use the real owner action to revoke the published reference.
    await page.getByRole('button', { name: 'UNPUBLISH', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('unpublished');
    expect(
      (await publicRequest.get(`http://127.0.0.1:4391${sourceUrl}`)).status(),
    ).toBe(404);
    expect(id).not.toBe('');
    // Neither a video block nor a trip-gallery selection may reuse the post-only exception.
    for (const video of [true, false]) {
      const blocked = await page.request.post('/api/trip/posts', {
        headers: { 'X-EmDash-Request': '1', Origin: 'http://127.0.0.1:4391' },
        data: {
          title: 'Sample blocked selection',
          day: '2026-10-31',
          place: '',
          gallery: video ? [] : [asset.id],
          publish: true,
          document: {
            type: 'doc',
            content: [
              {
                type: 'image',
                attrs: {
                  src,
                  mediaId: asset.id,
                  provider: 'local',
                  alt: 'sample',
                },
              },
              ...(video
                ? [
                    {
                      type: 'videoBlock',
                      attrs: { src, mediaId: asset.id, provider: 'local' },
                    },
                  ]
                : []),
            ],
          },
        },
      });
      expect(blocked.status()).toBe(200);
      const rejected = z
        .object({
          post: z.object({ status: z.string() }),
          publicationError: z.string(),
        })
        .parse(await blocked.json());
      expect(rejected.post.status).toBe('draft');
      expect(rejected.publicationError).not.toBe('');
    }
  } finally {
    await anonymous.close();
  }
});
