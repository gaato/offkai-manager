import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import {
  campaignFixtures,
  devStripeOrganizations,
  e2eUsers,
  paymentEventFixtures,
  participantFixtures,
  stripeSweepFixtures
} from './fixtures';
import { signInAs } from './auth';
import { authenticatedRouteManifest, pageRouteSweepFixtures, routeManifest } from './routes';

test.describe.configure({ mode: 'serial' });

function discoverPageRouteIds(root = resolve('src/routes')): string[] {
  const ids: string[] = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === '+page.svelte')) {
      const route = relative(root, directory).split(sep).join('/');
      ids.push(route ? `/${route}` : '/');
    }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(directory, entry.name));
    }
  };
  visit(root);
  return ids.sort();
}

function assertPageRouteSweepCoverage(discovered: readonly string[]): void {
  const fixtures = Object.keys(pageRouteSweepFixtures).sort();
  const missing = discovered.filter((routeId) => !fixtures.includes(routeId));
  const stale = fixtures.filter((routeId) => !discovered.includes(routeId));
  if (missing.length || stale.length) {
    throw new Error(
      `route sweep fixture mismatch; missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'}`
    );
  }
}

test('route sweep registry covers every Svelte page route', () => {
  assertPageRouteSweepCoverage(discoverPageRouteIds());
});

test('route sweep guard rejects a newly discovered route without a fixture', () => {
  expect(() =>
    assertPageRouteSweepCoverage([...discoverPageRouteIds(), '/__missing_sweep_fixture'])
  ).toThrow(/missing: \/__missing_sweep_fixture/);
});

const badMarkers = ['undefined', 'NaN', '[object Object]', '⟦'];
const rawEnums =
  /\b(owner|staff|viewer|organizer|active|disabled|draft|public|unlisted|auto_confirm|approval|cancelled|archived|pending|pending_external_creation|payment_pending|paid|waived|advance|onsite|internal)\b/g;
const participantRawEnums =
  /\b(applied|confirmed|waitlisted|cancelled|auto_confirm|approval|public|unlisted|pending|pending_external_creation|payment_pending|paid|waived|advance|onsite|internal)\b/g;
const opsRawEnums =
  /\b(owner|staff|viewer|auto_confirm|pending_external_creation|payment_pending|onsite|internal)\b/g;

const participantRoutes = [
  { path: '/events/public-fixtures/gathering', status: 200 },
  { path: '/events/public-fixtures/invitation', status: 200 },
  { path: '/events/public-fixtures/called-off', status: 200 },
  { path: '/events/public-fixtures/hidden-draft', status: 404 },
  { path: '/events/public-fixtures/past-record', status: 404 },
  { path: '/events/suspended-fixtures/unavailable', status: 404 }
] as const;

const campaignRoutes = [
  `/campaigns/${campaignFixtures.organizationSlug}/${campaignFixtures.openSlug}`,
  `/campaigns/${campaignFixtures.organizationSlug}/${campaignFixtures.closedSlug}`,
  `/campaigns/${campaignFixtures.notReadyOrganizationSlug}/${campaignFixtures.notReadySlug}`
] as const;

const pledgeStatusRoutes = Object.entries(campaignFixtures.tokens)
  .filter(([name]) => !['privatePaid', 'closedPaid'].includes(name))
  .map(([name, token]) => ({ name, path: `/pledges/${token}` }));

for (const locale of ['ja', 'en'] as const) {
  for (const route of participantRoutes) {
    test(`${route.path} participant fixture renders in ${locale}`, async ({ page }) => {
      const response = await page.goto(`${route.path}?lang=${locale}`);
      expect(response?.status()).toBe(route.status);
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(body.match(participantRawEnums) ?? []).toEqual([]);
      expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    });
  }
}

for (const locale of ['ja', 'en'] as const) {
  for (const path of campaignRoutes) {
    test(`${path} campaign fixture renders in ${locale}`, async ({ page }) => {
      const response = await page.goto(`${path}?lang=${locale}`);
      expect(response?.status()).toBe(200);
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(body.match(participantRawEnums) ?? []).toEqual([]);
      expect(body).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
      );
      expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    });
  }

  for (const fixture of pledgeStatusRoutes) {
    test(`${fixture.name} pledge status renders in ${locale}`, async ({ page }) => {
      const response = await page.goto(`${fixture.path}?lang=${locale}`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cache-control']).toContain('no-store');
      expect(response?.headers()['x-robots-tag']).toBe('noindex');
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(body.match(participantRawEnums) ?? []).toEqual([]);
      expect(body).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
      );
      expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    });
  }
}

test('invitation-only storefront emits noindex metadata', async ({ page }) => {
  await page.goto('/events/public-fixtures/invitation?lang=en');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test('called-off storefront shows its notice without the private reason', async ({ page }) => {
  await page.goto('/events/public-fixtures/called-off?lang=en');
  await expect(page.getByRole('alert')).toContainText('called off');
  await expect(page.locator('body')).not.toContainText('Fixture cancellation');
});

test('registration always requires a session even without an event Discord policy', async ({
  page
}) => {
  await page.goto('/events/public-fixtures/gathering/register?lang=en');
  expect(new URL(page.url()).pathname).toBe('/auth/dev');
  expect(new URL(page.url()).searchParams.get('return_to')).toBe(
    '/events/public-fixtures/gathering/register?lang=en'
  );
});

for (const locale of ['ja', 'en'] as const) {
  test(`registration form renders in ${locale}`, async ({ page }) => {
    const path = `/events/public-fixtures/gathering/register?lang=${locale}`;
    await signInAs(page, e2eUsers.sweepOwner, path, 'Sweep Owner');
    const body = await page.locator('body').innerText();
    for (const marker of badMarkers) expect(body).not.toContain(marker);
    expect(body.match(participantRawEnums) ?? []).toEqual([]);
    expect(body).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
  });

  test(`Discord join guidance renders in ${locale}`, async ({ page }) => {
    const path = `/events/public-fixtures/invitation/register/join?lang=${locale}`;
    await signInAs(page, e2eUsers.sweepOwner, path, 'Sweep Owner');
    await expect(
      page.getByRole('heading', {
        name:
          locale === 'ja'
            ? 'Discordサーバーに参加してください'
            : 'Join the Discord server to continue'
      })
    ).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: locale === 'ja' ? 'Discordの招待を開く' : 'Open the Discord invitation'
      })
    ).toHaveAttribute('href', 'https://discord.gg/offkai-fixture');
    const body = await page.locator('body').innerText();
    for (const marker of badMarkers) expect(body).not.toContain(marker);
    expect(body.match(participantRawEnums) ?? []).toEqual([]);
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
  });
}

for (const locale of ['ja', 'en'] as const) {
  for (const [status, fixture] of Object.entries(participantFixtures).filter(
    ([key]) => key !== 'withdrawal'
  )) {
    test(`${status} participant status renders in ${locale}`, async ({ page }) => {
      const path = `/registrations/${fixture.registrationId}?lang=${locale}`;
      await signInAs(page, fixture.discordUserId, path, fixture.displayName);
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(body.match(participantRawEnums) ?? []).toEqual([]);
      expect(body).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
      );
      expect(body).toContain('Display name preference');
      if (status === 'confirmed') {
        expect(body).toContain('5,000');
        expect(body).toContain(
          locale === 'ja' ? 'Stripeで￥5,000を安全に支払う' : 'Pay ¥5,000 securely with Stripe'
        );
      }
      if (status === 'paid') {
        expect(body).toContain(locale === 'ja' ? '支払い済み' : 'Payment received');
      }
      expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    });
  }

  test(`withdrawal confirmation renders in ${locale}`, async ({ page }) => {
    const fixture = participantFixtures.withdrawal;
    const path = `/registrations/${fixture.registrationId}/withdraw?lang=${locale}`;
    await signInAs(page, fixture.discordUserId, path, fixture.displayName);
    const body = await page.locator('body').innerText();
    for (const marker of badMarkers) expect(body).not.toContain(marker);
    expect(body.match(participantRawEnums) ?? []).toEqual([]);
    expect(body).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
  });
}

for (const locale of ['ja', 'en'] as const) {
  test(`Discord settings and check-in fixtures render in ${locale}`, async ({ page }) => {
    await signInAs(page, e2eUsers.sweepOwner, '/app', 'Sweep Owner');
    const organizationHref = await page
      .locator('a[href^="/app/organizations/"]')
      .filter({ hasText: 'Public Fixtures' })
      .first()
      .getAttribute('href');
    await page.goto(organizationHref!);
    const eventHref = await page
      .locator('a[href^="/app/events/"]')
      .filter({ hasText: 'Summer Gathering' })
      .first()
      .getAttribute('href');
    await page.goto(`${eventHref}/settings?lang=${locale}`);
    await expect(
      page.getByRole('heading', { name: locale === 'ja' ? 'Discord設定' : 'Discord settings' })
    ).toBeVisible();

    await page.goto(`${eventHref}/check-in?lang=${locale}`);
    await expect(page.getByText('Paid Participant', { exact: true })).toBeVisible();
    await expect(page.getByText('Secured Participant', { exact: true })).toBeVisible();
    await expect(
      page.getByText(locale === 'ja' ? '支払済み' : 'Paid', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(locale === 'ja' ? '未払い' : 'Unpaid', { exact: true }).first()
    ).toBeVisible();
    const body = await page.locator('body').innerText();
    for (const marker of badMarkers) expect(body).not.toContain(marker);
    expect(body.match(rawEnums) ?? []).toEqual([]);
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
  });
}

test('restricted venue address is shown only after a place is secured', async ({ page }) => {
  const pending = participantFixtures.applied;
  await signInAs(
    page,
    pending.discordUserId,
    `/registrations/${pending.registrationId}?lang=en`,
    pending.displayName
  );
  await expect(page.locator('body')).not.toContainText('1-2-3 Minato');

  await page.context().clearCookies();
  const secured = participantFixtures.confirmed;
  await signInAs(
    page,
    secured.discordUserId,
    `/registrations/${secured.registrationId}?lang=en`,
    secured.displayName
  );
  await expect(page.locator('body')).toContainText('1-2-3 Minato');
});

test('another participant receives a not-found response for a registration', async ({ page }) => {
  const owner = participantFixtures.confirmed;
  await signInAs(page, participantFixtures.applied.discordUserId, '/', 'Pending Participant');
  const response = await page.goto(`/registrations/${owner.registrationId}?lang=en`);
  expect(response?.status()).toBe(404);
});

test('an anonymous visitor receives a not-found response for a registration', async ({ page }) => {
  const response = await page.goto(
    `/registrations/${participantFixtures.confirmed.registrationId}?lang=en`
  );
  expect(response?.status()).toBe(404);
});

test('withdrawal works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const fixture = participantFixtures.withdrawal;
  await signInAs(
    page,
    fixture.discordUserId,
    `/registrations/${fixture.registrationId}/withdraw?lang=en`,
    fixture.displayName
  );
  await page.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await page.waitForURL(`**/registrations/${fixture.registrationId}?withdrawn=1`);
  await expect(page.getByText('Your registration was withdrawn.')).toBeVisible();
  await context.close();
});

for (const locale of ['ja', 'en'] as const) {
  for (const fixture of stripeSweepFixtures) {
    test(`${fixture.organizationName} renders its Stripe state in ${locale}`, async ({ page }) => {
      await signInAs(page, e2eUsers.sweepOwner, '/app', 'Sweep Owner');
      const href = await page
        .getByRole('link', { name: fixture.organizationName, exact: true })
        .getAttribute('href');
      expect(href).toBeTruthy();
      await page.goto(`${href}?lang=${locale}`);
      await expect(page.getByText(fixture.label[locale], { exact: true })).toBeVisible();
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(body.match(rawEnums) ?? []).toEqual([]);
      expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    });
  }

  test(`development onboarding and refresh pages render in ${locale}`, async ({ page }) => {
    await signInAs(page, e2eUsers.sweepOwner, '/app', 'Sweep Owner');
    const organizationHref = await page
      .getByRole('link', { name: devStripeOrganizations.sweep, exact: true })
      .getAttribute('href');
    expect(organizationHref).toBeTruthy();
    await page.goto(`${organizationHref}?lang=${locale}`);
    await page
      .getByRole('button', {
        name: locale === 'ja' ? 'オンボーディングを開始' : 'Start onboarding'
      })
      .click();
    await expect(page).toHaveURL(/\/dev\/stripe\/onboarding\/acct_dev_/);
    let body = await page.locator('body').innerText();
    for (const marker of badMarkers) expect(body).not.toContain(marker);
    expect(body.match(rawEnums) ?? []).toEqual([]);
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    await page
      .getByRole('button', { name: locale === 'ja' ? '未完了のまま戻る' : 'Leave incomplete' })
      .click();
    await expect(page).toHaveURL(new RegExp(`${organizationHref}[?]stripe=returned$`));

    await page.goto(`${organizationHref}/stripe/refresh`);
    await expect(page).toHaveURL(/\/dev\/stripe\/onboarding\/acct_dev_/);
    body = await page.locator('body').innerText();
    for (const marker of badMarkers) expect(body).not.toContain(marker);
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    await page
      .getByRole('button', { name: locale === 'ja' ? '未完了のまま戻る' : 'Leave incomplete' })
      .click();
  });
}

for (const locale of ['ja', 'en'] as const) {
  for (const route of routeManifest) {
    test(`${route.path} renders in ${locale}`, async ({ page }) => {
      const separator = route.path.includes('?') ? '&' : '?';
      const response = await page.goto(`${route.path}${separator}lang=${locale}`);
      expect(response?.status()).toBe(route.status);
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(body.match(rawEnums) ?? []).toEqual([]);
      if (route.document) {
        expect(await page.locator('html').getAttribute('lang')).toBe(locale);
      }
    });
  }
}

for (const locale of ['ja', 'en'] as const) {
  for (const route of authenticatedRouteManifest) {
    test(`${route.path} renders with a seeded fixture in ${locale}`, async ({ page }) => {
      await signInAs(page, e2eUsers.sweepOwner, '/app', 'Sweep Owner');
      const organizationHref = await page
        .locator('a[href^="/app/organizations/"]')
        .filter({ hasText: 'Sweep Workspace' })
        .first()
        .getAttribute('href');
      expect(organizationHref).toMatch(/^\/app\/organizations\/[0-9a-f-]+$/);
      await page.goto(`${organizationHref}?lang=${locale}`);
      const eventHref = await page
        .locator('a[href^="/app/events/"]')
        .filter({ hasText: 'Sweep Event' })
        .first()
        .getAttribute('href');
      expect(eventHref).toMatch(/^\/app\/events\/[0-9a-f-]+$/);
      const draftPaymentEventHref = await page
        .locator('a[href^="/app/events/"]')
        .filter({ hasText: paymentEventFixtures.draft })
        .first()
        .getAttribute('href');
      const frozenPaymentEventHref = await page
        .locator('a[href^="/app/events/"]')
        .filter({ hasText: paymentEventFixtures.frozen })
        .first()
        .getAttribute('href');
      expect(draftPaymentEventHref).toMatch(/^\/app\/events\/[0-9a-f-]+$/);
      expect(frozenPaymentEventHref).toMatch(/^\/app\/events\/[0-9a-f-]+$/);
      await page.goto('/app');
      const campaignOrganizationHref = await page
        .locator('a[href^="/app/organizations/"]')
        .filter({ hasText: 'Campaign Fixtures' })
        .first()
        .getAttribute('href');
      expect(campaignOrganizationHref).toMatch(/^\/app\/organizations\/[0-9a-f-]+$/);
      await page.goto(`${campaignOrganizationHref}/campaigns`);
      const campaignHref = await page
        .getByRole('link', { name: 'Community Flower Stand', exact: true })
        .getAttribute('href');
      expect(campaignHref).toMatch(/^\/app\/campaigns\/[0-9a-f-]+$/);
      await page.goto('/app');
      const participantOrganizationHref = await page
        .locator('a[href^="/app/organizations/"]')
        .filter({ hasText: 'Public Fixtures' })
        .first()
        .getAttribute('href');
      expect(participantOrganizationHref).toMatch(/^\/app\/organizations\/[0-9a-f-]+$/);
      await page.goto(participantOrganizationHref!);
      const participantEventHref = await page
        .locator('a[href^="/app/events/"]')
        .filter({ hasText: 'Summer Gathering' })
        .first()
        .getAttribute('href');
      expect(participantEventHref).toMatch(/^\/app\/events\/[0-9a-f-]+$/);
      const path = route.path
        .replace('/app/organizations/[fixture]', organizationHref!)
        .replace('/app/events/[event]', eventHref!)
        .replace('/app/events/[participant-event]', participantEventHref!)
        .replace('/app/events/[payments-draft-event]', draftPaymentEventHref!)
        .replace('/app/events/[payments-frozen-event]', frozenPaymentEventHref!)
        .replace('/app/campaigns/[campaign]', campaignHref!)
        .replace('[registration-applied]', participantFixtures.applied.registrationId)
        .replace('[registration-confirmed]', participantFixtures.confirmed.registrationId)
        .replace('[registration-waitlisted]', participantFixtures.waitlisted.registrationId)
        .replace('[registration-cancelled]', participantFixtures.cancelled.registrationId);
      const separator = path.includes('?') ? '&' : '?';
      await page.goto(`${path}${separator}lang=${locale}`);
      expect(page.url()).toContain(path);
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(body.match(rawEnums) ?? []).toEqual([]);
      expect(await page.locator('html').getAttribute('lang')).toBe(locale);
    });
  }
}

for (const locale of ['ja', 'en'] as const) {
  test(`platform operations routes render every fixture state in ${locale}`, async ({ page }) => {
    await signInAs(page, e2eUsers.sweepOwner, '/ops', 'Sweep Owner', true);
    await page.goto(`/ops/organizations?lang=${locale}`);
    const activeOrganizationHref = await page
      .getByRole('link', { name: 'Public Fixtures', exact: true })
      .getAttribute('href');
    const suspendedOrganizationHref = await page
      .getByRole('link', { name: 'Suspended Fixtures', exact: true })
      .getAttribute('href');
    expect(activeOrganizationHref).toBeTruthy();
    expect(suspendedOrganizationHref).toBeTruthy();

    await page.goto(`/ops/users?q=${encodeURIComponent(e2eUsers.inviteTarget)}&lang=${locale}`);
    const activeUserHref = await page
      .getByRole('link', { name: 'Invited Member', exact: true })
      .getAttribute('href');
    await page.goto(`/ops/users?q=${encodeURIComponent('Suspended User')}&lang=${locale}`);
    const suspendedUserHref = await page
      .getByRole('link', { name: 'Suspended User', exact: true })
      .getAttribute('href');
    expect(activeUserHref).toBeTruthy();
    expect(suspendedUserHref).toBeTruthy();

    const paths = [
      '/ops',
      '/ops/organizations',
      activeOrganizationHref!,
      `${activeOrganizationHref}/suspend`,
      suspendedOrganizationHref!,
      `${suspendedOrganizationHref}/unsuspend`,
      '/ops/users',
      `/ops/users?q=${encodeURIComponent(e2eUsers.inviteTarget)}`,
      activeUserHref!,
      `${activeUserHref}/suspend`,
      suspendedUserHref!,
      `${suspendedUserHref}/unsuspend`,
      '/ops/activity?action=platform.&target=',
      '/ops/payment-conflicts'
    ];
    for (const path of paths) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await page.goto(`${path}${separator}lang=${locale}`);
      expect(response?.status(), path).toBe(200);
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body, path).not.toContain(marker);
      expect(body.match(opsRawEnums) ?? [], path).toEqual([]);
      expect(await page.locator('html').getAttribute('lang'), path).toBe(locale);
    }
  });
}

for (const locale of ['ja', 'en'] as const) {
  test(`participant CSV returns a localized BOM export in ${locale}`, async ({ page }) => {
    await signInAs(page, e2eUsers.sweepOwner, '/app', 'Sweep Owner');
    const organizationHref = await page
      .locator('a[href^="/app/organizations/"]')
      .filter({ hasText: 'Public Fixtures' })
      .first()
      .getAttribute('href');
    await page.goto(organizationHref!);
    const eventHref = await page
      .locator('a[href^="/app/events/"]')
      .filter({ hasText: 'Summer Gathering' })
      .first()
      .getAttribute('href');
    const response = await page.request.get(`${eventHref}/participants.csv?lang=${locale}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toContain('attachment;');
    const body = await response.body();
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = body.toString('utf8');
    expect(text).toContain(
      locale === 'ja' ? '表示名,Discordユーザー名' : 'Display name,Discord username'
    );
    expect(text).toContain("'=SUM(1,1)");
  });
}
