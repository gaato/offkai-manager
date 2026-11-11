import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers, overdueParticipant, paymentEventFixtures } from './fixtures';

// The release is irreversible on the shared seed, so the read-only checks run first.
test.describe.configure({ mode: 'serial' });

async function openOverdueEvent(page: Page): Promise<string> {
  await signInAs(page, e2eUsers.sweepOwner, '/app', 'Sweep Owner');
  await page.getByRole('link', { name: 'Sweep Workspace', exact: true }).first().click();
  await page.getByRole('link', { name: paymentEventFixtures.overdue, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);
  return page.url();
}

test('organizers see the manual overdue rule, count and locked policy accessibly', async ({
  page
}) => {
  const eventUrl = await openOverdueEvent(page);
  for (const locale of ['ja', 'en'] as const) {
    await page.goto(`${eventUrl}?lang=${locale}`);
    await expect(page.locator('#payment-schedule')).toContainText(
      locale === 'ja' ? '期限切れの未払い：1人' : 'Overdue unpaid: 1'
    );
    for (const path of ['', '/release-overdue', '/settings']) {
      await page.goto(`${eventUrl}${path}?lang=${locale}`);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `${path || '/'} (${locale})`).toEqual([]);
    }
    // Payment requests exist, so the form explains that the rule may only become more lenient.
    await expect(
      page.getByText(
        locale === 'ja'
          ? '支払い依頼を出した後は、取り消せるようになる日時を早める変更'
          : 'After payment requests exist, changes that make cancellation possible earlier'
      )
    ).toBeVisible();
    await expect(
      page.getByLabel(locale === 'ja' ? '主催者が判断する' : 'Organizers decide', { exact: true })
    ).toBeChecked();
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('organizers confirm and release overdue unpaid registrations', async ({ page }) => {
    const eventUrl = await openOverdueEvent(page);
    await page.getByRole('link', { name: 'Cancel overdue unpaid registrations' }).click();
    await expect(page).toHaveURL(/\/release-overdue$/);
    await expect(page.getByText('This cancels the following registration')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: overdueParticipant })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel 1 registration', exact: true }).click();
    await expect(page).toHaveURL(eventUrl);
    await expect(page.locator('#payment-schedule')).not.toContainText('Overdue unpaid');

    await page.goto(`${eventUrl}/participants?status=cancelled&lang=en`);
    await expect(page.getByText(overdueParticipant)).toBeVisible();
    await page.goto(`${eventUrl}/release-overdue?lang=en`);
    await expect(page.getByText('No registrations are overdue.')).toBeVisible();
  });
});
