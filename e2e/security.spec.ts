import { expect, test } from '@playwright/test';
import { signSession } from '../src/lib/server/auth/session';
import { suspendedUserFixture } from './fixtures';

const primaryOrigin = `http://127.0.0.1:${process.env.OFFKAI_E2E_PRIMARY_PORT ?? '18080'}`;
const productionOrigin = `http://127.0.0.1:${process.env.OFFKAI_E2E_PRODUCTION_PORT ?? '18081'}`;

test('rejects cross-site browser POSTs', async ({ request }) => {
  const response = await request.post('/auth/dev?/signIn', {
    headers: {
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: 'userId=attacker&displayName=Attacker'
  });
  expect(response.status()).toBe(403);
});

test('limits the sixty-first protected POST', async ({ request }) => {
  for (let index = 0; index < 60; index += 1) {
    const response = await request.post('/auth/dev?/signIn', {
      headers: {
        Origin: primaryOrigin,
        'X-Test-Client-IP': 'rate-limit-fixture'
      }
    });
    expect(response.status()).not.toBe(429);
  }
  const limited = await request.post('/auth/dev?/signIn', {
    headers: {
      Origin: primaryOrigin,
      'X-Test-Client-IP': 'rate-limit-fixture'
    }
  });
  expect(limited.status()).toBe(429);
});

test('sets browser hardening and request correlation headers', async ({ request }) => {
  const response = await request.get('/');
  const headers = response.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
});

test('does not expose development routes when bypass is disabled', async ({ playwright }) => {
  const context = await playwright.request.newContext({
    baseURL: productionOrigin
  });
  try {
    for (const path of ['/auth/dev', '/dev/stripe/onboarding/acct_dev_example']) {
      const response = await context.get(path);
      expect(response.status(), path).toBe(404);
    }
  } finally {
    await context.dispose();
  }
});

test('accepts a same-origin form POST without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/auth/dev?lang=ja');
  await page.fill('[name=discordUserId]', '100000000000009999');
  await page.fill('[name=username]', 'nojs_regression');
  await page.fill('[name=displayName]', 'NoJS Regression');
  await page.click('button[type=submit]');
  await page.waitForURL('**/app**');
  await context.close();
});

test('CSP form-action allows Stripe hosted redirect targets', async ({ request }) => {
  const response = await request.get('/');
  const csp = response.headers()['content-security-policy'] ?? '';
  const formAction = csp.split(';').find((d) => d.trim().startsWith('form-action')) ?? '';
  expect(formAction).toContain('https://checkout.stripe.com');
  expect(formAction).toContain('https://connect.stripe.com');
});

test('preserves safe GET destinations and rejects open redirect return targets', async ({
  page
}) => {
  await page.goto('/app/events/10000000-0000-4000-8000-000000000099?lang=ja');
  expect(new URL(page.url()).pathname).toBe('/auth/dev');
  expect(new URL(page.url()).searchParams.get('return_to')).toBe(
    '/app/events/10000000-0000-4000-8000-000000000099?lang=ja'
  );

  await page.goto('/auth/dev?return_to=https://attacker.example/steal');
  await page.locator('input[name="discordUserId"]').fill('110000000000009901');
  await page.locator('input[name="username"]').fill('safe-return-user');
  await page.locator('input[name="displayName"]').fill('Safe Return User');
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/app'),
    page.locator('button[type="submit"]').click()
  ]);
});

test('rejects a tampered session and clears its cookie', async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: 'offkai_session', value: 'forged.payload', url: primaryOrigin }]);
  await page.goto('/app');
  expect(new URL(page.url()).pathname).toBe('/auth/dev');
  expect(
    (await page.context().cookies()).find(({ name }) => name === 'offkai_session')
  ).toBeUndefined();
});

test('clears a valid session after its user is suspended', async ({ page }) => {
  const value = signSession(
    {
      userId: suspendedUserFixture.userId,
      displayName: suspendedUserFixture.displayName,
      platformAdmin: false
    },
    'e2e-development-session-secret'
  );
  await page.context().addCookies([{ name: 'offkai_session', value, url: primaryOrigin }]);
  await page.goto('/app');
  expect(new URL(page.url()).pathname).toBe('/auth/dev');
  expect(
    (await page.context().cookies()).find(({ name }) => name === 'offkai_session')
  ).toBeUndefined();
});

test('forged session cookies cannot mint fresh rate-limit buckets', async ({ request }) => {
  for (let index = 0; index <= 60; index += 1) {
    const response = await request.post('/auth/dev?/signIn', {
      headers: {
        Cookie: `offkai_session=forged-${index}`,
        Origin: primaryOrigin,
        'X-Test-Client-IP': 'forged-cookie-rate-limit'
      },
      maxRedirects: 0
    });
    if (index < 60) expect(response.status()).not.toBe(429);
    else expect(response.status()).toBe(429);
  }
});

test('rate-limit buckets are isolated by client key', async ({ request }) => {
  for (let index = 0; index <= 60; index += 1) {
    await request.post('/auth/dev?/signIn', {
      headers: { Origin: primaryOrigin, 'X-Test-Client-IP': 'isolated-rate-limit-a' },
      maxRedirects: 0
    });
  }
  const independent = await request.post('/auth/dev?/signIn', {
    headers: { Origin: primaryOrigin, 'X-Test-Client-IP': 'isolated-rate-limit-b' },
    maxRedirects: 0
  });
  expect(independent.status()).not.toBe(429);
});
