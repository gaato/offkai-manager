import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { campaignFixtures, e2eUsers } from './fixtures';

const productionOrigin = `http://127.0.0.1:${process.env.OFFKAI_E2E_PRODUCTION_PORT ?? '18081'}`;
const noAbuseOrigin = `http://127.0.0.1:${process.env.OFFKAI_E2E_NO_ABUSE_PORT ?? '18082'}`;
const openCampaignPath = `/campaigns/${campaignFixtures.organizationSlug}/${campaignFixtures.openSlug}`;

test('campaign page shows paid totals, listed supporters, compliance, and pledge availability', async ({
  page
}) => {
  await page.goto(`${openCampaignPath}?lang=en`);
  await expect(page.getByRole('heading', { name: 'Community Flower Stand' })).toBeVisible();
  await expect(page.getByText(/4,500/).first()).toBeVisible();
  await expect(page.getByText(campaignFixtures.listedSupporter, { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(campaignFixtures.privateSupporter);
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeVisible();
  await expect(page.getByText('Identity-verified organizer', { exact: true })).toBeVisible();
  const abuseLink = page.getByRole('link', { name: 'Report this campaign' });
  await expect(abuseLink).toBeVisible();
  await expect(abuseLink).toHaveAttribute('href', /mailto:abuse@example\.test\?subject=/);
  await page.getByText('Information required by the Specified Commercial Transactions Act').click();
  await expect(page.getByText('Campaign Fixtures', { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/Article 11/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'campaign@example.test' }).last()).toHaveAttribute(
    'href',
    'mailto:campaign@example.test'
  );
});

test('closed and payment-setup campaigns suppress the pledge form', async ({ page }) => {
  await page.goto(
    `/campaigns/${campaignFixtures.organizationSlug}/${campaignFixtures.closedSlug}?lang=en`
  );
  await expect(page.getByText('Pledges closed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/1,000/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completion report' })).toBeVisible();
  await expect(page.getByText(/Materials cost/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);

  await page.goto(
    `/campaigns/${campaignFixtures.notReadyOrganizationSlug}/${campaignFixtures.notReadySlug}?lang=en`
  );
  await expect(page.getByText('Online pledges unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);
});

test('abuse report link is omitted when no reporting address is configured', async ({
  playwright
}) => {
  const context = await playwright.request.newContext({ baseURL: noAbuseOrigin });
  try {
    const response = await context.get(`${openCampaignPath}?lang=en`);
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain('Report this campaign');
  } finally {
    await context.dispose();
  }
});

test('campaign and bearer status routes are hidden when the feature flag is disabled', async ({
  playwright
}) => {
  const context = await playwright.request.newContext({ baseURL: productionOrigin });
  try {
    const home = await context.get('/');
    expect(await home.text()).not.toContain('/campaigns/');
    expect(await home.text()).not.toContain('/pledges/');
    for (const path of [
      openCampaignPath,
      `/pledges/${campaignFixtures.tokens.paid}`,
      '/app/campaigns/10000000-0000-4000-8000-000000000001',
      '/app/organizations/10000000-0000-4000-8000-000000000001/campaigns'
    ]) {
      const response = await context.get(path);
      expect(response.status(), path).toBe(404);
    }
  } finally {
    await context.dispose();
  }
});

test('organizer manages a campaign from creation through private pledge export and storage', async ({
  browser,
  browserName
}) => {
  const organizerContext = await browser.newContext();
  const organizer = await organizerContext.newPage();
  await signInAs(organizer, e2eUsers.organizer, '/app', 'Organizer Scenario');

  await organizer.getByRole('link', { name: 'Create group' }).first().click();
  const organizationName = `Campaign Console ${browserName}`;
  await organizer.getByLabel('Group name').fill(organizationName);
  await organizer.getByRole('button', { name: 'Create group' }).click();
  await expect(organizer).toHaveURL(/\/app\/organizations\/[0-9a-f-]+$/);

  await organizer.getByRole('button', { name: 'Start onboarding' }).click();
  await expect(organizer).toHaveURL(/\/dev\/stripe\/onboarding\/acct_dev_/);
  await organizer.getByRole('button', { name: 'Complete onboarding' }).click();
  await expect(organizer.getByText('Ready', { exact: true })).toBeVisible();

  await organizer.getByRole('link', { name: 'Support campaigns', exact: true }).click();
  const slug = `console-support-${browserName}`;
  await organizer.getByLabel('Title').fill(`Console Support ${browserName}`);
  await organizer.getByLabel('URL slug').fill(slug);
  await organizer.getByLabel('Description').fill('A complete console journey for campaign tools.');
  await organizer.getByLabel('Unit price (minor units)').fill('1200');
  await organizer.getByLabel('Goal (minor units, display only)').fill('6000');
  await organizer.getByLabel('Maximum units per pledge').fill('4');
  await organizer.getByRole('button', { name: 'Create campaign' }).click();
  await expect(organizer).toHaveURL(/\/app\/campaigns\/[0-9a-f-]+$/);
  const campaignAdminHref = new URL(organizer.url()).pathname;

  const settings = organizer.locator('form[action="?/settings"]');
  await settings.getByLabel('Description').fill('Updated from the organizer campaign console.');
  await settings.getByLabel('Planned fulfillment date').fill('2027-12-15');
  await settings
    .getByLabel('Fulfillment note')
    .fill('The planning team will publish a completion report.');
  await settings.getByLabel('Contact and disclosure request channel').fill('console@example.test');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(organizer.getByText('Campaign settings were saved.')).toBeVisible();

  await organizer.getByRole('button', { name: 'Start accepting pledges' }).click();
  await expect(organizer.getByText('Accepting pledges', { exact: true })).toBeVisible();
  const publicUrl = await organizer.locator('#campaign-share-url').inputValue();
  expect(new URL(publicUrl).pathname).toBe(`/campaigns/campaign-console-${browserName}/${slug}`);

  const guestContext = await browser.newContext({
    extraHTTPHeaders: { 'X-Test-Client-IP': `campaign-console-${browserName}` }
  });
  const guest = await guestContext.newPage();
  await guest.goto(`${publicUrl}?lang=en`);
  const privateDisplayName = `=Hidden Supporter ${browserName}`;
  await guest.getByLabel('Supporter display name').fill(privateDisplayName);
  await guest.getByLabel('Number of units').fill('2');
  await guest.getByLabel('Show my display name in the supporter list').uncheck();
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(guest).toHaveURL(/\/dev\/stripe\/checkout\/cs_dev_/);
  await guest.getByRole('button', { name: 'Pay now' }).click();
  await expect(guest.getByText('Payment complete', { exact: true })).toBeVisible();

  await organizer.goto(campaignAdminHref);
  const ledgerRow = organizer.getByRole('row').filter({ hasText: privateDisplayName });
  await expect(ledgerRow).toBeVisible();
  await expect(ledgerRow.getByText('Payment complete', { exact: true })).toBeVisible();
  await expect(ledgerRow.getByText('Guest checkout', { exact: true })).toBeVisible();
  await expect(organizer.getByText(/2,400/).first()).toBeVisible();

  await guest.goto(publicUrl);
  await expect(guest.locator('body')).not.toContainText(privateDisplayName);
  await expect(guest.getByText(/2,400/).first()).toBeVisible();

  await organizer.goto(campaignAdminHref);
  await organizer.getByRole('button', { name: 'Stop accepting pledges' }).click();
  await expect(organizer.getByText('Pledges closed', { exact: true })).toBeVisible();
  const reportText = `Delivered for ${browserName}. Materials: 1,800 yen. Venue transport: 600 yen.`;
  await organizer.getByLabel('Fulfillment result and spending breakdown').fill(reportText);
  await organizer.getByRole('button', { name: 'Publish completion report' }).click();
  await expect(
    organizer.getByText('The completion report is visible to supporters.')
  ).toBeVisible();
  await guest.goto(publicUrl);
  await expect(guest.getByRole('heading', { name: 'Completion report' })).toBeVisible();
  await expect(guest.getByText(reportText, { exact: true })).toBeVisible();
  const csvResponse = await organizer.request.get(`${campaignAdminHref}/pledges.csv?lang=en`);
  expect(csvResponse.status()).toBe(200);
  expect(csvResponse.headers()['content-disposition']).toContain('attachment;');
  const csv = await csvResponse.body();
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csvText = csv.toString('utf8');
  expect(csvText).toContain('Supporter display name,Units');
  expect(csvText).toContain(`'${privateDisplayName}`);

  await organizer.getByText('Store campaign record', { exact: true }).click();
  await organizer.getByRole('button', { name: 'Store permanently' }).click();
  await expect(organizer.getByText('Stored record', { exact: true })).toBeVisible();
  const hiddenResponse = await guest.goto(publicUrl);
  expect(hiddenResponse?.status()).toBe(404);

  await guestContext.close();
  await organizerContext.close();
});

test('a success return notice does not change an unsettled pledge', async ({ page }) => {
  await page.goto(`/pledges/${campaignFixtures.tokens.pending}?payment=success&lang=en`);
  await expect(page.getByText(/awaiting confirmation/)).toBeVisible();
  await expect(page.getByText('Pledge received', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment confirmed', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Report this campaign' })).toBeVisible();
});

test('a payment confirmed after expiry uses supporter-safe conflict wording', async ({ page }) => {
  await page.goto(`/pledges/${campaignFixtures.tokens.conflict}?lang=ja`);
  await expect(page.getByText('主催者が対応中です', { exact: true })).toBeVisible();
  await expect(
    page.getByText('お支払いを確認しました。企画側で確認し、必要な対応を行います。', {
      exact: true
    })
  ).toBeVisible();
});

test('pledge form completes without JavaScript and the return page does not settle by itself', async ({
  browser
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: { 'X-Test-Client-IP': 'campaign-nojs-pledge' }
  });
  const page = await context.newPage();
  await page.goto(`${openCampaignPath}?lang=en`);
  await page.getByLabel('Supporter display name').fill('NoJS Campaign Supporter');
  await page.getByLabel('Number of units').fill('2');
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.waitForURL(/\/dev\/stripe\/checkout\//);
  await expect(page.getByText(/3,000/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel payment' }).click();
  await page.waitForURL(/\/pledges\/.+[?]payment=cancelled/);
  await expect(page.getByText('Checkout expired', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment confirmed', { exact: true })).toHaveCount(0);
  await context.close();
});
