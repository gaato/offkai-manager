import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import {
  devStripeOrganizations,
  e2eUsers,
  paymentEventFixtures,
  stripeSweepFixtures
} from './fixtures';
import { signInAs } from './auth';
import { findRawEnums, opsRawEnums } from './render-guards';
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
    await page.goto(`${eventHref}/discord?lang=${locale}`);
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
    expect(findRawEnums(body, locale)).toEqual([]);
    expect(await page.locator('html').getAttribute('lang')).toBe(locale);
  });
}

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
      expect(findRawEnums(body, locale)).toEqual([]);
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
    expect(findRawEnums(body, locale)).toEqual([]);
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
      expect(findRawEnums(body, locale)).toEqual([]);
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
        .replace('/legal/[fixture]', organizationHref!.replace('/app/organizations/', '/legal/'))
        .replace('/app/organizations/[fixture]', organizationHref!)
        .replace('/app/events/[event]', eventHref!)
        .replace('/app/events/[participant-event]', participantEventHref!)
        .replace('/app/events/[payments-draft-event]', draftPaymentEventHref!)
        .replace('/app/events/[payments-frozen-event]', frozenPaymentEventHref!);
      const separator = path.includes('?') ? '&' : '?';
      await page.goto(`${path}${separator}lang=${locale}`);
      expect(page.url()).toContain(path);
      const body = await page.locator('body').innerText();
      for (const marker of badMarkers) expect(body).not.toContain(marker);
      expect(findRawEnums(body, locale)).toEqual([]);
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
      expect(findRawEnums(body, locale, opsRawEnums), path).toEqual([]);
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
