import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { devStripeOrganizations, e2eUsers } from './fixtures';

test('owner completes the development Stripe onboarding loop in Japanese', async ({ page }) => {
  await signInAs(page, e2eUsers.sweepOwner, '/app?lang=ja', 'Sweep Owner');
  const organizationHref = await page
    .getByRole('link', { name: devStripeOrganizations.journey, exact: true })
    .getAttribute('href');
  expect(organizationHref).toBeTruthy();

  await page.goto(`${organizationHref}?lang=ja`);
  await expect(page.getByText('未接続', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'オンボーディングを開始' }).click();
  await expect(page).toHaveURL(/\/dev\/stripe\/onboarding\/acct_dev_/);
  await expect(page.getByRole('heading', { name: 'Stripe Connectオンボーディング' })).toBeVisible();

  await page.getByRole('button', { name: 'オンボーディングを完了' }).click();
  await expect(page).toHaveURL(new RegExp(`${organizationHref}[?]stripe=returned$`));
  await expect(page.getByText('利用可能', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Stripeオンボーディングの状態を更新しました。'
  );
});
