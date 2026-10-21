import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers, paidJourney } from './fixtures';

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
    .getByRole('radio', { name: '100', exact: true })
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
