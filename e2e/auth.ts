import { expect, type Page } from '@playwright/test';

let signInSequence = 0;

export async function signInAs(
  page: Page,
  discordUserId: string,
  returnTo = '/app',
  displayName = 'E2E Organizer',
  platformAdmin = false
): Promise<void> {
  signInSequence += 1;
  await page.setExtraHTTPHeaders({ 'X-Test-Client-IP': `sign-in-${signInSequence}` });
  await page.goto(`/auth/dev?return_to=${encodeURIComponent(returnTo)}&lang=en`);
  await page.getByLabel('Discord user ID', { exact: true }).fill(discordUserId);
  await page
    .getByLabel('Discord username', { exact: true })
    .fill(`user-${discordUserId.slice(-6)}`);
  await page.getByLabel('Display name', { exact: true }).fill(displayName);
  if (platformAdmin) await page.getByLabel('Platform administrator', { exact: true }).check();
  await page.getByRole('button', { name: 'Create development session' }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(returnTo)}(?:[?].*)?$`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
