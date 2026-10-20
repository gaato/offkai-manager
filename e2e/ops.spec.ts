import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers, opsJourney } from './fixtures';

const primaryOrigin = `http://127.0.0.1:${process.env.OFFKAI_E2E_PRIMARY_PORT ?? '18080'}`;

test.describe.configure({ mode: 'serial' });

test('platform admin suspends and restores an organization through the ops console', async ({
  page
}) => {
  await signInAs(page, e2eUsers.sweepOwner, '/ops', 'Sweep Owner', true);
  await expect(page.getByRole('heading', { name: 'Platform dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Organizations', exact: true }).click();
  const opsDetailPath = await page
    .getByRole('link', { name: opsJourney.organizationName, exact: true })
    .getAttribute('href');
  expect(opsDetailPath).toBeTruthy();
  await page.goto(opsDetailPath!);
  const organizerEventHref = await page
    .getByRole('link', { name: opsJourney.eventTitle, exact: true })
    .getAttribute('href');
  expect(organizerEventHref).toBeTruthy();
  const publicEventPath = `/events/${opsJourney.organizationSlug}/${opsJourney.eventSlug}`;
  expect((await page.request.get(publicEventPath)).status()).toBe(200);

  await page.getByRole('link', { name: 'Suspend organization', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Suspend organization' })).toBeVisible();
  await page.getByLabel('Reason').fill('E2E platform suspension verification');
  await page.getByRole('button', { name: 'Confirm suspension' }).click();
  await expect(page).toHaveURL(new RegExp(`${opsDetailPath!}[?]suspended=1$`));

  expect((await page.request.get(publicEventPath)).status()).toBe(404);
  await page.goto(organizerEventHref!);
  await expect(page.getByText('This organization is suspended', { exact: true })).toBeVisible();
  await expect(page.getByText(/changes are disabled/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make unlisted' })).toHaveCount(0);

  const mutation = await page.request.post(`${organizerEventHref}?/toggleUnlisted`, {
    headers: {
      Accept: 'application/json',
      Origin: primaryOrigin,
      'x-sveltekit-action': 'true'
    },
    form: {}
  });
  expect(mutation.status()).toBe(200);
  await expect(mutation.json()).resolves.toEqual(
    expect.objectContaining({ type: 'failure', status: 403 })
  );

  await page.goto(opsDetailPath!);
  await page.getByRole('link', { name: 'Restore organization', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Restore organization' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm restoration' }).click();
  await expect(page).toHaveURL(new RegExp(`${opsDetailPath!}[?]unsuspended=1$`));

  expect((await page.request.get(publicEventPath)).status()).toBe(200);
  await page.goto(organizerEventHref!);
  await expect(page.getByText('This organization is suspended', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Make unlisted' })).toBeVisible();
});

test('non-admin sessions receive not found from every ops route', async ({ page }) => {
  await signInAs(page, e2eUsers.organizer, '/app', 'Organizer Scenario');
  const missingId = '00000000-0000-4000-8000-000000000001';
  const routes = [
    '/ops',
    '/ops/organizations',
    `/ops/organizations/${missingId}`,
    `/ops/organizations/${missingId}/suspend`,
    `/ops/organizations/${missingId}/unsuspend`,
    '/ops/users',
    `/ops/users/${missingId}`,
    `/ops/users/${missingId}/suspend`,
    `/ops/users/${missingId}/unsuspend`,
    '/ops/activity',
    '/ops/payment-conflicts'
  ];

  for (const route of routes) {
    const response = await page.request.get(route);
    expect(response.status(), route).toBe(404);
  }
});
