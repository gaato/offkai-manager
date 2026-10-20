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
  await page.goto(`/auth/dev?return_to=${encodeURIComponent(returnTo)}`);
  await page.locator('input[name="discordUserId"]').fill(discordUserId);
  await page.locator('input[name="username"]').fill(`user-${discordUserId.slice(-6)}`);
  await page.locator('input[name="displayName"]').fill(displayName);
  if (platformAdmin) await page.locator('input[name="platformAdmin"]').check();
  await page.getByRole('button', { name: 'Create development session' }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(returnTo)}(?:[?].*)?$`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
