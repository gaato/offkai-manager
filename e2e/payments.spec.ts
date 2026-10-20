import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers, paymentJourney } from './fixtures';

test('complete development checkout and refund-conflict journey', async ({ browser }) => {
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
  const paymentsHref = `${eventHref}/payments`;
  await organizer.locator('input[name="title"]').fill('Journey participation fee');
  await organizer.locator('input[name="amountYen"]').fill('5000');
  await organizer.locator('textarea[name="instructions"]').fill('Use the hosted checkout.');
  await organizer.getByRole('button', { name: 'Create collection' }).click();
  await expect(organizer.getByText('The collection was created.')).toBeVisible();
  await organizer.getByRole('button', { name: 'Open collection' }).click();
  await expect(organizer.getByText('Open', { exact: true })).toBeVisible();

  const registrationPath = `/events/${paymentJourney.organizationSlug}/${paymentJourney.eventSlug}/register`;
  const paidContext = await browser.newContext();
  const paidParticipant = await paidContext.newPage();
  await signInAs(
    paidParticipant,
    e2eUsers.paymentParticipant,
    registrationPath,
    'Payment Participant'
  );
  await paidParticipant.getByRole('button', { name: 'Submit registration' }).click();
  await expect(paidParticipant).toHaveURL(/\/registrations\/[0-9a-f-]+$/);
  await paidParticipant.getByRole('button', { name: 'Pay ¥5,000 securely with Stripe' }).click();
  await expect(paidParticipant).toHaveURL(/\/dev\/stripe\/checkout\/cs_dev_/);
  await paidParticipant.getByRole('button', { name: 'Pay now' }).click();
  await expect(paidParticipant.getByText('Payment received', { exact: true })).toBeVisible();

  await organizer.goto(paymentsHref);
  const paidRow = organizer.getByRole('row').filter({ hasText: 'Payment Participant' });
  await expect(paidRow.getByText('Paid', { exact: true })).toBeVisible();
  const summary = organizer.locator('section[aria-labelledby="payment-summary-title"]');
  const paidMetric = summary.getByText('Paid', { exact: true }).locator('..');
  await expect(paidMetric).toContainText('¥5,000');
  await expect(paidMetric).toContainText('1 people');

  const conflictContext = await browser.newContext();
  const conflictParticipant = await conflictContext.newPage();
  await signInAs(
    conflictParticipant,
    e2eUsers.paymentConflictParticipant,
    registrationPath,
    'Conflict Participant'
  );
  await conflictParticipant.getByRole('button', { name: 'Submit registration' }).click();
  await expect(conflictParticipant).toHaveURL(/\/registrations\/[0-9a-f-]+$/);
  await conflictParticipant
    .getByRole('button', { name: 'Pay ¥5,000 securely with Stripe' })
    .click();
  await expect(conflictParticipant).toHaveURL(/\/dev\/stripe\/checkout\/cs_dev_/);

  await organizer.goto(`${eventHref}/participants`);
  await organizer.getByRole('link', { name: 'View registration for Conflict Participant' }).click();
  await organizer.getByRole('link', { name: 'Cancel registration' }).click();
  await organizer.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(organizer.getByText('The registration was cancelled.')).toBeVisible();

  await conflictParticipant.getByRole('button', { name: 'Pay now' }).click();
  await organizer.goto(paymentsHref);
  await expect(organizer.getByRole('heading', { name: 'Refund action required' })).toBeVisible();
  await expect(organizer.getByText(/Conflict Participant · ¥5,000/)).toBeVisible();
  await organizer.getByRole('button', { name: 'Mark refund completed' }).click();
  await expect(organizer.getByRole('heading', { name: 'Confirm refund follow-up' })).toBeVisible();
  await organizer.locator('input[name="note"]').fill('Refunded in the Stripe dashboard.');
  await organizer.getByRole('button', { name: 'Record as refunded' }).click();
  await expect(organizer.getByText('The refund was recorded.')).toBeVisible();
  await expect(organizer.getByRole('heading', { name: 'Refund action required' })).toHaveCount(0);

  await paidContext.close();
  await conflictContext.close();
  await organizerContext.close();
});
