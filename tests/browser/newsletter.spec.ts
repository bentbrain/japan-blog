import { expect, test } from '@playwright/test';

const plugin = '/_emdash/api/plugins/japan-newsletter';

test('public signup is accessible, reports unavailable transport honestly and blocks owner access', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  const form = page.getByRole('region', {
    name: 'journal updates',
  });
  await expect(form).toBeVisible();
  await form
    .getByLabel('email', { exact: true })
    .fill('synthetic-reader@example.com');
  await form.getByRole('button', { name: 'SUBSCRIBE', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText(
    'signups are temporarily unavailable. please try again later.',
  );
  expect(
    (
      await page.request.get(`${plugin}/owner`, {
        headers: { 'X-EmDash-Request': '1' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post(`${plugin}/manage`, {
        headers: { 'X-EmDash-Request': '1', Origin: baseURL ?? '' },
        data: { action: 'test' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (await page.request.get('/api/trip/newsletter-preview')).status(),
  ).toBe(401);
});

test('confirmation uses an explicit action, strips tokens from the address bar and disables caching', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(`${plugin}/confirm`))
      requests.push(request.method());
  });
  const response = await page.goto(
    `/newsletter/confirm?token=${'a'.repeat(64)}`,
  );
  expect(response?.headers()['cache-control']).toContain('no-store');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page).toHaveURL(/\/newsletter\/confirm$/);
  await expect(
    page.getByRole('button', { name: 'CONFIRM SUBSCRIPTION' }),
  ).toBeEnabled();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'CONFIRM SUBSCRIPTION' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'this link has expired. please sign up again.',
  );
  expect(requests).toEqual(['POST']);
});

test('owner settings use private plugin storage, start paused and reject missing CSRF', async ({
  page,
  baseURL,
}) => {
  const headers = { 'X-EmDash-Request': '1', Origin: baseURL ?? '' };
  expect(
    (
      await page.request.post('/_emdash/api/setup/dev-bypass', {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=/owner/newsletter');
  await expect(
    page.getByRole('heading', { name: 'newsletter', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('automatic sending paused', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'day', exact: true }),
  ).toHaveText(/sunday/);
  await expect(
    page.getByRole('checkbox', { name: 'automatic sending' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'SEND ME A TEST' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: /^next digest/ }),
  ).toBeVisible();
  expect((await page.request.get(`${plugin}/owner`)).status()).toBe(403);
  const denied = await page.request.post(`${plugin}/manage`, {
    data: { action: 'test' },
  });
  expect(denied.status()).toBe(403);
  await page.getByRole('button', { name: 'SAVE SCHEDULE' }).click();
  await expect(page.getByRole('status')).toHaveText('schedule saved.');
  const response = await page.request.get('/api/trip/newsletter-preview');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-security-policy']).toContain(
    "default-src 'none'",
  );
  expect(response.headers()['cache-control']).toContain('no-store');
});

for (const width of [320, 390]) {
  test(`newsletter form fits a ${String(width)}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'SUBSCRIBE', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}
