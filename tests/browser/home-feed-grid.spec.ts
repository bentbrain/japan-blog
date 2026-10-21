import { test, expect, type Page } from '@playwright/test';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';

const run = crypto.randomUUID();
const posts: { id: string; day: string; title: string }[] = [];
const created = z.object({
  data: z.object({ item: z.object({ id: z.string() }), _rev: z.string() }),
});

test.beforeAll(async ({ request, baseURL }) => {
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  expect(
    (
      await request.post('/_emdash/api/setup/dev-bypass', { headers, data: {} })
    ).ok(),
  ).toBe(true);
  await request.get('/_emdash/api/auth/dev-bypass');
  // Creation order deliberately differs from calendar order. Equal days also
  // exercise the CMS's stable descending ID tie-breaker.
  for (const [index, { day, paragraphs }] of [
    { day: 12, paragraphs: 1 },
    { day: 17, paragraphs: 4 },
    { day: 13, paragraphs: 2 },
    { day: 16, paragraphs: 3 },
    { day: 15, paragraphs: 1 },
    { day: 17, paragraphs: 2 },
    { day: 14, paragraphs: 3 },
  ].entries()) {
    const title = `Synthetic grid card ${String(index + 1)}`;
    const date = `2099-10-${String(day)}`;
    const response = await request.post('/_emdash/api/content/posts', {
      headers,
      data: {
        slug: `synthetic-grid-${String(index)}-${run}`,
        data: {
          title,
          day: date,
          demo: true,
          content: Array.from({ length: paragraphs }, (_, paragraph) => ({
            _type: 'block',
            _key: `paragraph-${String(paragraph)}`,
            style: 'normal',
            markDefs: [],
            children: [
              {
                _type: 'span',
                _key: 'text',
                marks: [],
                text: 'Synthetic card text for checking chronological rows and equal spacing with different amounts of content.',
              },
            ],
          })),
        },
      },
    });
    expect(response.ok()).toBe(true);
    const { item, _rev } = created.parse(await response.json()).data;
    posts.push({ id: item.id, day: date, title });
    expect(
      (
        await request.post(`/_emdash/api/content/posts/${item.id}/publish`, {
          headers,
          data: { _rev },
        })
      ).ok(),
    ).toBe(true);
  }
});

test.afterAll(async ({ request, baseURL }) => {
  await request.get('/_emdash/api/auth/dev-bypass');
  for (const { id } of posts)
    expect(
      (
        await request.delete(`/_emdash/api/content/posts/${id}`, {
          headers: { 'X-EmDash-Request': '1', Origin: baseURL ?? '' },
        })
      ).ok(),
    ).toBe(true);
});

async function measure(page: Page) {
  return page.locator('.journal-grid').evaluate((grid) => {
    const rect = grid.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      cards: Array.from(grid.querySelectorAll('article')).map((article) => {
        const card = article.querySelector('.journal-card-inner');
        if (!card) throw new Error('Card border required');
        const { x, y, width, height } = card.getBoundingClientRect();
        return {
          x,
          y,
          width,
          height,
          title: article.querySelector('h1')?.textContent.trim(),
        };
      }),
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(
    javaScriptEnabled ? 'loaded feed' : 'server-rendered feed',
    () => {
      test.use({ javaScriptEnabled });
      for (const colorScheme of ['light', 'dark'] satisfies (
        'light' | 'dark'
      )[])
        test(`chronological rows and equal visible gaps in ${colorScheme}`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          await page.route('**/toolbar.bent.build/**', (route) =>
            route.fulfill({ contentType: 'application/javascript', body: '' }),
          );
          await page.goto('/');
          if (javaScriptEnabled)
            await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
          await page.evaluate(() => document.fonts.ready);
          const expected = [...posts].sort(
            (a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id),
          );
          for (const width of [1991, 390, 601, 901, 1991]) {
            await page.setViewportSize({ width, height: 1138 });
            await page.locator('article').first().scrollIntoViewIfNeeded();
            const metrics = await measure(page);
            const evidence = process.env.FEED_GRID_EVIDENCE;
            if (evidence && [1991, 390].includes(width)) {
              const name = `${String(width)}-${colorScheme}-${javaScriptEnabled ? 'loaded' : 'no-js'}`;
              await page.screenshot({
                path: `${evidence}/${name}.png`,
                caret: 'initial',
                fullPage: true,
              });
              await writeFile(
                `${evidence}/${name}.json`,
                JSON.stringify(metrics, null, 2),
              );
            }
            expect(metrics.cards.map((card) => card.title)).toEqual(
              expected.map((post) => post.title),
            );
            expect(metrics.overflow).toBe(0);
            const columns = width > 900 ? 3 : width > 600 ? 2 : 1;
            for (let index = 0; index < metrics.cards.length; index++) {
              const card = metrics.cards[index];
              if (!card) throw new Error('Card required');
              const rowStart = metrics.cards[index - (index % columns)];
              if (!rowStart) throw new Error('Row start required');
              expect(card.y).toBeCloseTo(rowStart.y, 1);
              expect(card.height).toBeCloseTo(rowStart.height, 1);
              if (index % columns === 0)
                expect(card.x).toBeCloseTo(metrics.left, 1);
              const previous = metrics.cards[index - 1];
              if (index % columns && previous)
                expect(card.x - previous.x - previous.width).toBeCloseTo(16, 1);
              const above = metrics.cards[index - columns];
              if (above)
                expect(card.y - above.y - above.height).toBeCloseTo(16, 1);
              expect(card.x + card.width).toBeLessThanOrEqual(
                metrics.right + 1,
              );
            }
            // Seven cards leave a single left-aligned card on the final row at
            // both multi-column breakpoints, with empty cells only to its right.
            const final = metrics.cards.at(-1);
            if (!final) throw new Error('Incomplete row required');
            expect(final.x).toBeCloseTo(metrics.left, 1);
            if (columns > 1)
              expect(metrics.right - final.x - final.width).toBeGreaterThan(
                final.width - 1,
              );
          }
        });
    },
  );
}

test('equal-day chronology stays stable across earlier pages', async ({
  page,
  request,
  baseURL,
}) => {
  await request.get('/_emdash/api/auth/dev-bypass');
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  // Put a tied day across the 24-post boundary. A publication-time sort or an
  // unstable cursor would lose, duplicate or reorder these older calendar days.
  for (let index = 0; index < 22; index++) {
    const title = `Synthetic pagination card ${String(index)}`;
    const response = await request.post('/_emdash/api/content/posts', {
      headers,
      data: {
        slug: `grid-page-${String(index)}-${run}`,
        data: { title, day: '2099-10-12', demo: true },
      },
    });
    expect(response.ok()).toBe(true);
    const { item, _rev } = created.parse(await response.json()).data;
    posts.push({ id: item.id, day: '2099-10-12', title });
    expect(
      (
        await request.post(`/_emdash/api/content/posts/${item.id}/publish`, {
          headers,
          data: { _rev },
        })
      ).ok(),
    ).toBe(true);
  }
  const expected = [...posts]
    .sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id))
    .map((post) => post.title);
  await page.goto('/');
  const titles = page.locator('.journal-grid article h1');
  await expect(titles).toHaveText(expected.slice(0, 24));
  const first = await titles.allTextContents();
  await page.getByRole('link', { name: 'EARLIER →' }).click();
  await expect(titles).toHaveText(expected.slice(24));
  const combined = [...first, ...(await titles.allTextContents())].map(
    (title) => title.trim(),
  );
  expect(combined).toEqual(expected);
  expect(new Set(combined).size).toBe(posts.length);
  await expect(page.getByRole('link', { name: 'EARLIER →' })).toHaveCount(0);
});
