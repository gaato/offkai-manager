import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers, paymentJourney } from './fixtures';

test('organizer opens a collection and records a seeded participant payment', async ({
  browser
}) => {
  const organizerContext = await browser.newContext();
  const organizer = await organizerContext.newPage();
  await signInAs(organizer, e2eUsers.paymentOrganizer, '/app', 'Payment Organizer');

  const organizationLink = organizer.getByRole('link', {
    name: paymentJourney.organizationName,
    exact: true
  });
  const organizationHref = await organizationLink.getAttribute('href');
  expect(organizationHref).toBeTruthy();
  await organizationLink.click();
  await organizer.getByRole('button', { name: 'Start onboarding' }).click();
  await expect(organizer).toHaveURL(/\/dev\/stripe\/onboarding\/acct_dev_/);
  await organizer.getByRole('button', { name: 'Complete onboarding' }).click();
  await expect(organizer.getByText('Ready', { exact: true })).toBeVisible();

  const eventLink = organizer.getByRole('link', { name: paymentJourney.eventTitle, exact: true });
  const eventHref = await eventLink.getAttribute('href');
  expect(eventHref).toBeTruthy();
  await eventLink.click();
  await organizer.getByRole('link', { name: 'Payments', exact: true }).click();
  await organizer.getByLabel('Collection title').fill('Journey participation fee');
  await organizer.getByLabel('Amount (yen)').fill('5000');
  await organizer.getByLabel('General instructions').fill('Use the hosted checkout.');
  await organizer.getByRole('button', { name: 'Create collection' }).click();
  await expect(organizer.getByText('The collection was created.')).toBeVisible();
  await organizer.getByRole('button', { name: 'Open collection' }).click();
  await expect(organizer.getByText('Open', { exact: true })).toBeVisible();

  const participantRow = organizer.getByRole('row').filter({ hasText: 'Payment Participant' });
  await expect(participantRow).toBeVisible();
  await participantRow.getByRole('button', { name: 'Record payment', exact: true }).click();
  await organizer.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await expect(participantRow.getByText('Paid', { exact: true })).toBeVisible();
  const summary = organizer.locator('section[aria-labelledby="payment-summary-title"]');
  const paidMetric = summary.getByRole('group', { name: 'Paid', exact: true });
  await expect(paidMetric).toContainText('¥5,000');
  await expect(paidMetric).toContainText('1 people');

  await organizerContext.close();
});
