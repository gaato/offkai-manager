import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers } from './fixtures';

async function expectAccessible(page: Page, path?: string): Promise<void> {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    // DaisyUI animates color changes; axe must see the settled theme, not a mid-transition blend.
    // Only running, finite animations can settle; the timeout guards against any that never do.
    await page.evaluate(() =>
      Promise.race([
        Promise.allSettled(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === 'running' &&
                animation.effect?.getTiming().iterations !== Infinity
            )
            .map((animation) => animation.finished)
        ),
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ])
    );
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${path ?? page.url()} (${colorScheme})`).toEqual([]);
  }
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

for (const locale of ['ja', 'en'] as const) {
  for (const path of ['/', '/terms'] as const) {
    test(`${path} has no automated accessibility violations in ${locale}`, async ({ page }) => {
      await page.goto(`${path}?lang=${locale}`);
      await expectAccessible(page);
    });
  }
}

for (const locale of ['ja', 'en'] as const) {
  test(`platform operations pages have no automated accessibility violations in ${locale}`, async ({
    page
  }) => {
    await signInAs(page, e2eUsers.sweepOwner, '/ops', 'Sweep Owner', true);
    await page.goto(`/ops/organizations?lang=${locale}`);
    const activeOrganizationHref = await page
      .getByRole('link', { name: 'Public Fixtures', exact: true })
      .getAttribute('href');
    const suspendedOrganizationHref = await page
      .getByRole('link', { name: 'Suspended Fixtures', exact: true })
      .getAttribute('href');
    await page.goto(`/ops/users?q=${e2eUsers.inviteTarget}&lang=${locale}`);
    const activeUserHref = await page
      .getByRole('link', { name: 'Invited Member', exact: true })
      .getAttribute('href');
    await page.goto(`/ops/users?q=Suspended%20User&lang=${locale}`);
    const suspendedUserHref = await page
      .getByRole('link', { name: 'Suspended User', exact: true })
      .getAttribute('href');
    expect(activeOrganizationHref).toBeTruthy();
    expect(suspendedOrganizationHref).toBeTruthy();
    expect(activeUserHref).toBeTruthy();
    expect(suspendedUserHref).toBeTruthy();

    for (const path of [
      '/ops',
      '/ops/organizations',
      activeOrganizationHref!,
      `${activeOrganizationHref}/suspend`,
      suspendedOrganizationHref!,
      `${suspendedOrganizationHref}/unsuspend`,
      '/ops/users',
      `/ops/users?q=${e2eUsers.inviteTarget}`,
      activeUserHref!,
      `${activeUserHref}/suspend`,
      suspendedUserHref!,
      `${suspendedUserHref}/unsuspend`,
      '/ops/activity',
      '/ops/payment-conflicts'
    ]) {
      const separator = path.includes('?') ? '&' : '?';
      await page.goto(`${path}${separator}lang=${locale}`);
      await expectAccessible(page, path);
    }
  });
}

for (const locale of ['ja', 'en'] as const) {
  for (const destination of [
    'dashboard',
    'organization',
    'team',
    'participants',
    'check-in',
    'payments'
  ] as const) {
    test(`${destination} has no automated accessibility violations in ${locale}`, async ({
      page
    }) => {
      await signInAs(page, e2eUsers.sweepOwner, '/app', 'Sweep Owner');
      let path = '/app';
      if (
        destination === 'participants' ||
        destination === 'check-in' ||
        destination === 'payments'
      ) {
        const organizationHref = await page
          .locator('a[href^="/app/organizations/"]')
          .filter({ hasText: 'Public Fixtures' })
          .first()
          .getAttribute('href');
        expect(organizationHref).toBeTruthy();
        await page.goto(organizationHref!);
        const eventHref = await page
          .locator('a[href^="/app/events/"]')
          .filter({ hasText: 'Summer Gathering' })
          .first()
          .getAttribute('href');
        expect(eventHref).toBeTruthy();
        path = `${eventHref}/${destination}`;
        if (destination === 'check-in') await page.setViewportSize({ width: 390, height: 844 });
      } else if (destination !== 'dashboard') {
        const organizationHref = await page
          .locator('a[href^="/app/organizations/"]')
          .filter({ hasText: 'Sweep Workspace' })
          .first()
          .getAttribute('href');
        expect(organizationHref).toBeTruthy();
        path = destination === 'team' ? `${organizationHref}/team` : organizationHref!;
      }
      await page.goto(`${path}?lang=${locale}`);
      await expectAccessible(page);
    });
  }
}
