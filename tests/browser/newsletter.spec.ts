import { expect, test } from '@playwright/test';

const plugin = '/_emdash/api/plugins/japan-newsletter';

test('public signup is accessible, reports unavailable transport honestly and blocks owner access', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  const form = page.getByRole('region', {
    name: 'newsletter',
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

for (const width of [320, 390, 1280]) {
  test(`newsletter stays above the shop on one line at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const signup = page.getByRole('region', { name: 'newsletter' });
    const email = signup.getByRole('textbox', { name: 'email', exact: true });
    const subscribe = signup.getByRole('button', {
      name: 'SUBSCRIBE',
      exact: true,
    });
    await expect(subscribe).toBeEnabled();
    // Other suites seed public posts. Keep this short-page fixture independent.
    await page
      .locator('.journal-grid > article, .pagination')
      .evaluateAll((entries) => {
        for (const entry of entries) entry.remove();
      });
    await expect(signup.getByRole('heading')).toHaveCount(0);
    await expect(signup.getByRole('link')).toHaveCount(0);
    await expect(signup.getByRole('status')).toBeEmpty();
    const labelBox = await signup
      .locator('label[for="newsletter-email"]')
      .boundingBox();
    expect(labelBox?.height).toBeLessThanOrEqual(1);
    const inputBox = await email.boundingBox();
    const buttonBox = await subscribe.boundingBox();
    const shopBox = await page
      .getByRole('link', { name: 'shop.bent.build ↗' })
      .boundingBox();
    const footer = page.getByRole('contentinfo');
    const footerBox = await footer.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(shopBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    if (!inputBox || !buttonBox || !shopBox || !footerBox) return;
    expect(inputBox.y).toBe(buttonBox.y);
    expect(inputBox.height).toBe(buttonBox.height);
    expect(inputBox.x + inputBox.width).toBeLessThan(buttonBox.x);
    expect(inputBox.x).toBe(shopBox.x);
    expect(buttonBox.x + buttonBox.width).toBe(shopBox.x + shopBox.width);
    expect(inputBox.y + inputBox.height).toBeLessThan(shopBox.y);
    await expect(
      footer.getByRole('link', { name: 'email privacy' }),
    ).toHaveAttribute('href', '/newsletter/privacy');
    expect(footerBox.y + footerBox.height).toBe(844);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

test('signup validates email and preserves pending and confirmation feedback', async ({
  page,
}) => {
  let submissions = 0;
  let finishResponse: (() => void) | undefined;
  const responseReady = new Promise<void>((resolve) => {
    finishResponse = resolve;
  });
  await page.route(`${plugin}/subscribe`, async (route) => {
    submissions++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({
      email: 'synthetic-reader@example.com',
      website: '',
    });
    await responseReady;
    await route.fulfill({ json: { success: true, data: { ok: true } } });
  });
  await page.goto('/');
  const signup = page.getByRole('region', { name: 'newsletter' });
  const email = signup.getByRole('textbox', { name: 'email', exact: true });
  const subscribe = signup.getByRole('button', {
    name: 'SUBSCRIBE',
    exact: true,
  });
  await expect(subscribe).toBeEnabled();
  await subscribe.click();
  expect(submissions).toBe(0);
  await email.fill('invalid');
  await subscribe.click();
  expect(submissions).toBe(0);
  await email.fill('synthetic-reader@example.com');
  await subscribe.click();
  await expect(signup.getByRole('button', { name: 'SENDING…' })).toBeDisabled();
  await expect(email).toBeDisabled();
  finishResponse?.();
  await expect(signup.getByRole('status')).toHaveText(
    'check your inbox for a confirmation link.',
  );
  await expect(subscribe).toBeEnabled();
  await expect(email).toHaveValue('');
  expect(submissions).toBe(1);
});

test('footer follows content when the page grows beyond the viewport', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('region', { name: 'newsletter' }).evaluate((signup) => {
    const content = document.createElement('div');
    content.style.height = '1200px';
    content.textContent = 'synthetic layout fixture';
    signup.before(content);
  });
  const footerBox = await page.getByRole('contentinfo').boundingBox();
  const shopBox = await page
    .getByRole('link', { name: 'shop.bent.build ↗' })
    .boundingBox();
  expect(footerBox).not.toBeNull();
  expect(shopBox).not.toBeNull();
  if (!footerBox || !shopBox) return;
  expect(footerBox.y).toBeGreaterThan(800);
  expect(footerBox.y).toBeGreaterThan(shopBox.y + shopBox.height);
});
