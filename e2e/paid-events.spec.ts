import AxeBuilder from '@axe-core/playwright';
import { registrationModes, registrationModeLabelKey } from '../src/lib/shared/event';
import { paymentRequirements, paymentRequirementLabelKey } from '../src/lib/shared/payment';
import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers, paidJourney, paymentEventFixtures } from './fixtures';
import { translator } from '../src/lib/i18n';

test('only payouts documents allow Connect and navigation restores the strict CSP', async ({
  page
}) => {
  await signInAs(page, e2eUsers.sweepOwner);
  await page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/organizations\/[^/?]+$/);
  const organizationUrl = page.url();
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().isNavigationRequest() &&
        new URL(response.url()).pathname.endsWith('/payouts')
    ),
    page.getByRole('link', { name: 'Payout account', exact: true }).click()
  ]);
  const policy = response.headers()['content-security-policy'];
  const directives = new Map(
    policy.split(';').map((value) => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, sources];
    })
  );
  for (const name of ['script-src', 'frame-src']) {
    expect(directives.get(name)).toEqual(
      expect.arrayContaining(['https://connect-js.stripe.com', 'https://js.stripe.com'])
    );
  }
  expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'https://*.stripe.com']);
  expect(directives.get('style-src')).toContain(
    "'sha256-0hAheEzaMe6uXIKV4EehS9pu1am1lj/KnnzrOYqckXk='"
  );
  // Current Connect CSP docs require connect-src additions only for custom fonts.
  expect(directives.get('connect-src')).toEqual(["'self'"]);
  expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  const nonce = directives.get('script-src')?.find((value) => value.startsWith("'nonce-"));
  expect(nonce).toBeTruthy();
  expect(await response.text()).toContain(`nonce="${nonce!.slice(7, -1)}"`);
  for (const path of ['/', '/app', organizationUrl]) {
    const other = await page.request.get(path);
    const otherPolicy = other.headers()['content-security-policy'];
    expect(otherPolicy).not.toMatch(
      /connect-js\.stripe|js\.stripe|https:\/\/\*\.stripe|sha256-0hAhe/
    );
  }
  const [strictResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().isNavigationRequest() &&
        new URL(response.url()).pathname === new URL(organizationUrl).pathname
    ),
    page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click()
  ]);
  expect(strictResponse.headers()['content-security-policy']).not.toContain(
    'connect-js.stripe.com'
  );
});

for (const locale of ['en', 'ja'] as const) {
  test(`Connect.js load failure shows one ${locale} fallback without retries or unhandled errors`, async ({
    page
  }) => {
    const t = translator(locale);
    await signInAs(page, e2eUsers.sweepOwner);
    await page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click();
    const payoutsHref = await page
      .getByRole('link', { name: 'Payout account', exact: true })
      .getAttribute('href');
    // Exercise the production loader with a fake key; intercept the script locally.
    // The normal pk_test_stub journey below continues to render placeholders.
    await page.route('**/payouts?*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replaceAll('pk_test_stub', 'pk_test_load_failure')
      });
    });
    let attempts = 0;
    await page.route('https://connect-js.stripe.com/**', async (route) => {
      attempts++;
      await route.abort('failed');
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${payoutsHref}?lang=${locale}`);
    const alert = page.getByRole('alert').filter({ hasText: t('payouts.embed_failed') });
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveText(t('payouts.embed_failed'));
    await expect(
      page.getByRole('button', { name: t('payouts.hosted'), exact: true })
    ).toBeVisible();
    await expect(page.locator('stripe-connect-payments')).toHaveCount(0);
    // Advance beyond the loader timeout: no delayed retry or rejected cleanup.
    await page.clock.install();
    await page.clock.fastForward(60_000);
    expect(attempts).toBe(1);
    expect(errors).toEqual([]);
    await expect(alert).toHaveCount(1);
  });
}

test('payouts embeds onboarding with a fake Account Session and no Stripe JS', async ({ page }) => {
  await signInAs(page, e2eUsers.sweepOwner);
  await page.getByRole('link', { name: paidJourney.payoutOrganizationName, exact: true }).click();
  await page.getByRole('link', { name: 'Payout account', exact: true }).click();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/payouts/session', (route) =>
    route.fulfill({ json: { clientSecret: 'e2e_account_session' } })
  );
  await page.getByRole('button', { name: 'Create payout account' }).click();
  await expect(page.getByTestId('stripe-placeholder')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Complete account setup' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account notifications' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account details' })).toBeVisible();
  await expect.poll(() => requests.some((url) => url.endsWith('/payouts/session'))).toBe(true);
  expect(requests.some((url) => /connect-js.stripe|js.stripe/.test(url))).toBe(false);
  await expect(page.getByRole('button', { name: 'Continue on Stripe' })).toBeVisible();
});
test('event creation recomputes the fee breakdown and accepts a price override', async ({
  page
}) => {
  await signInAs(page, e2eUsers.sweepOwner);
  await page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click();
  await page.getByRole('link', { name: 'Create event', exact: true }).click();
  await page.getByLabel('Confirm now, pay later', { exact: true }).check();
  await page.getByLabel('Amount to collect per person (JPY)', { exact: true }).fill('5000');
  await expect(page.getByTestId('participant-price')).toContainText('5,187');
  await page
    .getByRole('group', { name: 'Round price up to (JPY)', exact: true })
    .getByRole('radio', { name: 'Multiples of ¥100', exact: true })
    .check();
  await expect(page.getByTestId('participant-price')).toContainText('5,200');
  await page.getByLabel('Override participant price (JPY, optional)', { exact: true }).fill('5500');
  await expect(page.getByTestId('participant-price')).toContainText('5,500');
  await expect(page.getByTestId('fee-breakdown')).toContainText('Estimated take-home');
  await expect(
    page.getByText('Cash and PayPay payers pay the same price.', { exact: true })
  ).toBeVisible();
  await page.getByLabel('Event title', { exact: true }).fill('Paid creation test');
  await page.getByRole('button', { name: 'Create event', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/events\/[^/]+$/);
});
test('organizer records cash for a confirmed unpaid pay-later registration', async ({ page }) => {
  await signInAs(page, e2eUsers.sweepOwner);
  await page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click();
  await page.getByRole('link', { name: paidJourney.eventTitle, exact: true }).click();
  await page.getByRole('link', { name: 'Payments', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Pay Later Participant' });
  await expect(row.getByText('Unpaid', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await expect(row.getByText('Paid', { exact: true })).toBeVisible();
});

// Stub the vendor script, exercising the actual initializer without a Stripe network call.
test('Connect appearance follows DaisyUI light/dark colors and a running theme change', async ({
  page
}) => {
  await signInAs(page, e2eUsers.sweepOwner);
  await page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click();
  const href = await page
    .getByRole('link', { name: 'Payout account', exact: true })
    .getAttribute('href');
  await page.route('**/payouts?*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replaceAll('pk_test_stub', 'pk_test_appearance')
    });
  });
  await page.route('**/payouts/session', (route) =>
    route.fulfill({ json: { clientSecret: 'fake_appearance_session' } })
  );
  await page.route('https://connect-js.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
      for (const name of ['account-onboarding','notification-banner','account-management','balances','payouts','payments']) {
        customElements.define('stripe-connect-' + name, class extends HTMLElement {
          setConnector() {}
          setOnLoadErrorInternalOnly() {}
        });
      }
      window.StripeConnect = {init(params) {
        document.documentElement.dataset.connectInitialAppearance = JSON.stringify(params.appearance.variables);
        return {
          connect: {},
          update(options) { document.documentElement.dataset.connectAppearance = JSON.stringify(options.appearance.variables); },
          logout: async () => {}
        };
      }};
    `
    })
  );
  const colors = () =>
    page.evaluate(
      () =>
        JSON.parse(document.documentElement.dataset.connectAppearance ?? '{}') as Record<
          string,
          string
        >
    );
  const contrast = (a: string, b: string) => {
    const luminance = (value: string) =>
      value
        .match(/\d+/g)!
        .map(Number)
        .map((n) => {
          const s = n / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const expectedColors = () =>
    page.locator('stripe-connect-payments').evaluate((element) => {
      const context = document.createElement('canvas').getContext('2d')!;
      const tokens = getComputedStyle(element);
      return ['base-100', 'base-content', 'primary', 'primary-content'].map((token) => {
        context.fillStyle = tokens.getPropertyValue(`--color-${token}`).trim();
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      });
    });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${href}?lang=en`);
  await expect.poll(async () => (await colors()).colorText).toBeTruthy();
  const light = await colors();
  expect([
    light.colorBackground,
    light.colorText,
    light.colorPrimary,
    light.buttonPrimaryColorText
  ]).toEqual(await expectedColors());
  expect(contrast(light.colorText, light.colorBackground)).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await colors()).colorBackground).not.toBe(light.colorBackground);
  const dark = await colors();
  expect([
    dark.colorBackground,
    dark.colorText,
    dark.colorPrimary,
    dark.buttonPrimaryColorText
  ]).toEqual(await expectedColors());
  expect(contrast(dark.colorText, dark.colorBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(dark.colorSecondaryText, dark.colorBackground)).toBeGreaterThanOrEqual(4.5);
  // Also pin initial dark-mode load, rather than only the update API.
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(document.documentElement.dataset.connectInitialAppearance ?? '{}')
            .colorBackground
      )
    )
    .toBe(dark.colorBackground);
});

for (const locale of ['ja', 'en'] as const) {
  test(`event creation and settings radio names use visible ${locale} labels`, async ({ page }) => {
    const t = translator(locale);
    await signInAs(page, e2eUsers.sweepOwner);
    await page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/organizations\/[^/?]+$/);
    const orgUrl = page.url();
    const eventHref = await page
      .getByRole('link', { name: paidJourney.eventTitle, exact: true })
      .getAttribute('href');
    for (const path of [
      `${orgUrl}/events/new?lang=${locale}`,
      `${eventHref}/settings?lang=${locale}`
    ]) {
      expect((await page.goto(path))?.status()).toBe(200);
      for (const mode of registrationModes) {
        const radio = page.getByRole('radio', {
          name: t(registrationModeLabelKey(mode)),
          exact: true
        });
        await expect(radio).toBeVisible();
        await expect(radio).toHaveAccessibleName(t(registrationModeLabelKey(mode)));
      }
      for (const requirement of paymentRequirements) {
        await expect(
          page.getByRole('radio', { name: t(paymentRequirementLabelKey(requirement)), exact: true })
        ).toBeVisible();
      }
      for (const unit of [1, 10, 100]) {
        await expect(
          page.getByRole('radio', { name: t('payment.rounding_unit', { unit }), exact: true })
        ).toBeVisible();
      }
      await expect(
        page.getByLabel(t('payment.price_pending_option'), { exact: true })
      ).toBeVisible();
      await expect(page.getByLabel(t('payment.opens_at'), { exact: true })).toBeVisible();
      await expect(page.getByLabel(t('payment.due_at'), { exact: true })).toBeVisible();
      await expect(
        page.getByLabel(t('payment.additional_opens_at'), { exact: true })
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  });
}

test('organizer legal disclosure is public and names the organization', async ({ page }) => {
  await signInAs(page, e2eUsers.sweepOwner);
  const org = await page
    .getByRole('link', { name: paidJourney.organizationName, exact: true })
    .getAttribute('href');
  await page.context().clearCookies();
  const path = org!.replace('/app/organizations/', '/legal/');
  for (const locale of ['ja', 'en'] as const) {
    const response = await page.goto(`${path}?lang=${locale}`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: paidJourney.organizationName, exact: true })
    ).toBeVisible();
  }
  expect((await page.request.get('/legal/00000000-0000-4000-8000-000000000000')).status()).toBe(
    404
  );
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(`Frozen payment settings (JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'})`, () => {
    test.use({ javaScriptEnabled });
    test('explains locked payment fields and still saves the other settings', async ({ page }) => {
      await signInAs(page, e2eUsers.sweepOwner);
      await page.getByRole('link', { name: 'Sweep Workspace', exact: true }).first().click();
      await expect(page).toHaveURL(/\/app\/organizations\/[0-9a-f-]+$/);
      await page.getByRole('link', { name: paymentEventFixtures.frozen, exact: true }).click();
      await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);
      await page.goto(`${page.url()}/settings?lang=en`);
      await expect(page.getByText(/Participants already have payments/)).toBeVisible();
      for (const requirement of paymentRequirements)
        await expect(page.locator(`#paymentRequirement-${requirement}`)).toBeDisabled();
      for (const field of ['paymentOpensAt', 'paymentDueAt', 'additionalOpensAt'])
        await expect(page.locator(`#${field}`)).toBeEnabled();
      await expect(page.getByLabel('Cash', { exact: true })).toBeEnabled();
      const mainForm = page.locator('form[action="?/settings"]');
      await mainForm.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'The event settings were saved.' })
      ).toBeVisible();
    });
  });
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(`Payment schedule validation (JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'})`, () => {
    test.use({ javaScriptEnabled });
    test('validates create fields and accepts a pending fee', async ({ page }) => {
      await signInAs(page, e2eUsers.sweepOwner);
      await page.getByRole('link', { name: paidJourney.organizationName, exact: true }).click();
      await page.getByRole('link', { name: 'Create event', exact: true }).click();
      await page.getByLabel('Confirm now, pay later', { exact: true }).check();
      await page.getByLabel('Decide the participation fee later', { exact: true }).check();
      await page.getByLabel('Event title', { exact: true }).fill(`Scheduled ${javaScriptEnabled}`);
      await page.getByLabel('Start date and time', { exact: true }).fill('2027-12-31T18:00');
      await page.getByLabel('Payment opens', { exact: true }).fill('2027-12-31T14:00');
      await page.getByLabel('Payment deadline', { exact: true }).fill('2027-12-31T13:00');
      await page
        .getByLabel('Additional recruitment opens (optional)', { exact: true })
        .fill('2027-12-31T12:00');
      await page.getByRole('button', { name: 'Create event', exact: true }).click();
      await expect(
        page.getByText(/Payment opening must be before the deadline/).first()
      ).toBeVisible();

      await page.getByLabel('Payment deadline', { exact: true }).fill('2027-12-31T16:00');
      await page
        .getByLabel('Additional recruitment opens (optional)', { exact: true })
        .fill('2027-12-31T14:00');
      await page.getByRole('button', { name: 'Create event', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/events\/[^/]+$/);
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: 'Set the participation fee before payment opens' })
      ).toBeVisible();
    });
  });
}
