import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { encode } from 'fast-png';

const created = z.object({
  data: z.object({ item: z.object({ id: z.string() }) }),
});

test('an existing URL image is imported before republishing without weakening media eligibility', async ({
  page,
  browser,
}) => {
  await page.request.post('/_emdash/api/setup/dev-bypass', {
    headers: { 'X-EmDash-Request': '1' },
    data: {},
  });
  await page.route('https://toolbar.bent.build/embed.js', (route) =>
    route.fulfill({ body: '' }),
  );
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/posts/new');
  const result = await page.request.post('/_emdash/api/content/posts', {
    headers: { 'X-EmDash-Request': '1', Origin: 'http://127.0.0.1:4391' },
    data: {
      slug: 'synthetic-legacy-image',
      data: {
        title: 'Synthetic legacy image',
        day: '2026-10-15',
        gallery: [],
        content: [
          {
            _type: 'block',
            _key: 'paragraph',
            style: 'normal',
            children: [
              {
                _type: 'span',
                _key: 'text',
                text: 'Synthetic saved story',
                marks: [],
              },
            ],
            markDefs: [],
          },
          {
            _type: 'image',
            _key: 'legacy-image',
            asset: { _ref: 'https://legacy.example.invalid/synthetic.png' },
            alt: 'Synthetic saved image',
          },
        ],
      },
    },
  });
  expect(result.status()).toBe(201);
  const id = created.parse(await result.json()).data.item.id;
  const saved = z
    .object({ revision: z.string() })
    .parse(await (await page.request.get(`/api/trip/posts?id=${id}`)).json());
  const headers = { 'X-EmDash-Request': '1', Origin: 'http://127.0.0.1:4391' };
  const sourceInput = {
    id,
    revision: saved.revision,
    source: 'https://legacy.example.invalid/synthetic.png',
  };
  expect(
    (
      await page.request.post('/api/trip/post-image-source', {
        data: sourceInput,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/trip/post-image-source', {
        headers,
        data: { ...sourceInput, revision: 'stale' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post('/api/trip/post-image-source', {
        headers,
        data: {
          ...sourceInput,
          source: 'https://unrelated.example.invalid/other.png',
        },
      })
    ).status(),
  ).toBe(400);
  // The real Workers route must fail closed for an unresolvable saved host.
  expect(
    (
      await page.request.post('/api/trip/post-image-source', {
        headers,
        data: sourceInput,
      })
    ).status(),
  ).toBe(422);
  const graphic = Buffer.from(
    encode({
      width: 160,
      height: 80,
      channels: 3,
      data: new Uint8Array(160 * 80 * 3).fill(80),
    }),
  );
  await page.route('https://legacy.example.invalid/synthetic.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: graphic }),
  );
  // Source acquisition is isolated; preparation, upload, stored-reference save
  // and the actual publication policy run against the ephemeral application.
  let imports = 0;
  let rejectSource = true;
  let uploads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/trip/upload')) {
      uploads++;
      expect(request.postDataBuffer()?.includes(graphic)).toBe(true);
    }
  });
  await page.route('**/api/trip/post-image-source', (route) => {
    imports++;
    return rejectSource
      ? route.fulfill({
          status: 422,
          json: { error: 'Synthetic source failure' },
        })
      : route.fulfill({ contentType: 'image/png', body: graphic });
  });
  await page.goto(`/owner/posts/${id}`);
  const editor = page.getByRole('textbox', { name: 'Post content' });
  await expect(editor.locator('img')).toHaveCount(1);
  await page.getByRole('button', { name: 'PUBLISH', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Could not import the saved image. Try again.',
  );
  expect(uploads).toBe(0);
  await expect(editor.locator('img')).toHaveAttribute(
    'src',
    'https://legacy.example.invalid/synthetic.png',
  );
  rejectSource = false;
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/trip/upload') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'SAVE DRAFT', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('draft saved');
  const displayUrl = z
    .object({ sourceUrl: z.string() })
    .parse(await (await uploaded).json()).sourceUrl;
  const imageUrl = await editor.locator('img').getAttribute('src');
  if (!imageUrl) throw new Error('Imported image required');
  const anonymous = await browser.newContext();
  try {
    expect(
      (
        await anonymous.request.get(`http://127.0.0.1:4391${displayUrl}`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await anonymous.request.post(
          'http://127.0.0.1:4391/api/trip/post-image-source',
          { data: {} },
        )
      ).status(),
    ).toBe(401);
    await page.getByRole('button', { name: 'PUBLISH', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('published');
    expect(
      (
        await anonymous.request.get(`http://127.0.0.1:4391${displayUrl}`)
      ).status(),
    ).toBe(200);
  } finally {
    await anonymous.close();
  }

  if (process.env.LEGACY_IMAGE_SCREENSHOT)
    await page.screenshot({ path: process.env.LEGACY_IMAGE_SCREENSHOT });
  await expect(page.getByRole('status')).toHaveText('published');
  await expect(editor.locator('img')).toHaveAttribute(
    'src',
    /^\/_emdash\/api\/media\/asset\//,
  );
  await page.reload();
  await expect(editor.locator('img')).toHaveAttribute(
    'src',
    /^\/_emdash\/api\/media\/asset\//,
  );
  await page.getByRole('button', { name: 'PUBLISH', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('published');
  expect(imports).toBe(2);
  expect(uploads).toBe(1);
});
