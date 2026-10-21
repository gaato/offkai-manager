import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers } from './fixtures';

test('organizer creates a group and manages a team member', async ({ page }) => {
  await signInAs(page, e2eUsers.organizer);
  await page.getByRole('link', { name: 'Create group' }).first().click();
  await page.getByLabel('Group name').fill('Organizer Scenario');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page).toHaveURL(/\/app\/organizations\/[0-9a-f-]+$/);

  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByLabel('Discord user ID').fill(e2eUsers.inviteTarget);
  await page.getByLabel('Access level', { exact: true }).selectOption('organizer');
  await page.getByRole('button', { name: 'Add member' }).click();
  const memberRow = page.getByRole('row', { name: /Invited Member/ });
  await expect(memberRow).toBeVisible();

  await memberRow.getByLabel(/Change access level/).selectOption('staff');
  await memberRow.getByRole('button', { name: 'Review change' }).click();
  await expect(page.getByText('Change Invited Member to Staff?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(memberRow.getByRole('cell', { name: 'Staff', exact: true })).toBeVisible();

  await memberRow.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByText('Disable workspace access for Invited Member?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(memberRow.getByRole('cell', { name: 'Disabled', exact: true })).toBeVisible();
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(`Event settings (JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'})`, () => {
    test.use({ javaScriptEnabled });
    test('event settings and Discord forms save via their named actions', async ({ page }) => {
      await signInAs(page, e2eUsers.organizer);
      await page.getByRole('link', { name: 'Create group' }).first().click();
      await page.getByLabel('Group name').fill('Settings Regression');
      await page.getByRole('button', { name: 'Create group' }).click();
      await expect(page).toHaveURL(/\/app\/organizations\/[0-9a-f-]+$/);
      const organizationUrl = page.url();
      await page.goto(`${organizationUrl}/disclosure`);
      const sellerName = page.getByLabel('Seller name', { exact: true });
      await sellerName.fill('Settings Regression Seller');
      await page.getByLabel('Email', { exact: true }).fill('seller@example.test');
      await page
        .getByLabel('Disclose address and phone without delay on request', { exact: true })
        .check();
      await page.getByLabel('Default cancellation and refund policy').fill('No refunds.');
      await page.getByRole('button', { name: 'Save disclosure' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Disclosure saved.' })).toBeVisible();
      await expect(sellerName).toHaveValue('Settings Regression Seller');
      await page.goto(organizationUrl);
      await page.getByRole('link', { name: 'Create event' }).first().click();
      await page.getByLabel('Event title', { exact: true }).fill('Settings Regression Event');
      await page.getByLabel('Start date and time').fill('2026-12-01T18:00');
      await page.getByRole('button', { name: 'Create event', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);
      await page.getByRole('button', { name: 'Publish event' }).click();
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      const mainForm = page.locator('form[action="?/settings"]');
      const capacity = mainForm.getByLabel('Capacity', { exact: true });
      const save = mainForm.getByRole('button', { name: 'Save changes', exact: true });
      const saved = page.getByRole('status').filter({ hasText: 'The event settings were saved.' });
      await expect(capacity).toHaveValue('');
      await save.click();
      await expect(saved).toBeVisible();
      await page.reload();
      await expect(capacity).toHaveValue('');
      await capacity.fill('40');
      await save.click();
      await expect(saved).toBeVisible();
      await expect(capacity).toHaveValue('40');
      await page.reload();
      await expect(capacity).toHaveValue('40');
      await capacity.fill('');
      await save.click();
      await expect(saved).toBeVisible();
      await page.reload();
      await expect(capacity).toHaveValue('');
      await expect(page.getByLabel('English panel body', { exact: true })).toHaveCount(0);
      await page.getByRole('link', { name: 'Discord', exact: true }).click();
      const discordForm = page.locator('form[action="?/discord"]');
      await discordForm.getByRole('button', { name: 'Save Discord settings' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'The Discord settings were saved.' })
      ).toBeVisible();
    });
  });
}
