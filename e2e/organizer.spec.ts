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

test('event settings and Discord forms save via their named actions', async ({ page }) => {
  await signInAs(page, e2eUsers.organizer);
  await page.getByRole('link', { name: 'Create group' }).first().click();
  await page.getByLabel('Group name').fill('Settings Regression');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page).toHaveURL(/\/app\/organizations\/[0-9a-f-]+$/);

  await page.getByRole('link', { name: 'Create event' }).first().click();
  await page.getByLabel(/title/i).fill('Settings Regression Event');
  await page.locator('[name=startsAt]').fill('2026-12-01T18:00');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);

  await page.getByRole('button', { name: 'Publish event' }).click();
  await expect(page.locator('#event-share-url')).toHaveValue(/\/events\//);

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const mainForm = page.locator('form[action="?/settings"]');
  await expect(mainForm).toBeVisible();
  await mainForm.locator('button[type=submit]').click();
  await expect(page.locator('main')).toContainText(/saved|保存/);

  const discordForm = page.locator('form[action="?/discord"]');
  await expect(discordForm).toBeVisible();
  await discordForm.locator('button[type=submit]').click();
  await expect(page.locator('main')).not.toContainText('500');
});
