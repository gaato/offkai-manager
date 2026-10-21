import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { e2eUsers } from './fixtures';
import { translator } from '../src/lib/i18n';

for (const javaScriptEnabled of [true, false]) {
  test.describe(`Organizer disclosure (JavaScript ${javaScriptEnabled})`, () => {
    test.use({ javaScriptEnabled });
    test('paid publication is blocked until disclosure; form and public page work in ja/en', async ({
      page,
      browser
    }) => {
      await signInAs(page, e2eUsers.sweepOwner);
      await page
        .getByRole('link', {
          name: `Legal Disclosure Fixtures ${javaScriptEnabled ? 'JS' : 'NoJS'}`,
          exact: true
        })
        .click();
      await expect(page).toHaveURL(/\/app\/organizations\/[0-9a-f-]+$/);
      const orgUrl = page.url();
      await page.getByRole('link', { name: 'Disclosure Required Event', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);
      await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);
      const eventUrl = page.url();
      // Each JS variant starts with its own fresh organization and paid draft to keep the gate meaningful.
      {
        await page.getByRole('button', { name: 'Publish event', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Complete the organization disclosure');
      }
      await page.goto(`${orgUrl}/disclosure?lang=en`);
      await page.getByLabel('Seller name', { exact: true }).fill('Reception Organizer');
      await page.getByLabel('Email', { exact: true }).fill('reception@example.test');
      await page
        .getByLabel('Disclose address and phone without delay on request', { exact: true })
        .check();
      await page
        .getByLabel('Default cancellation and refund policy', { exact: true })
        .fill('Please contact the organizer before the event for refund requests.');
      await page.getByRole('button', { name: 'Save disclosure', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Disclosure saved.');
      const orgId = new URL(orgUrl).pathname.split('/').at(-1)!;
      for (const locale of ['ja', 'en'] as const) {
        const t = translator(locale);
        await page.goto(`${orgUrl}/disclosure?lang=${locale}`);
        if (javaScriptEnabled)
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        const context = await browser.newContext({ javaScriptEnabled });
        const publicPage = await context.newPage();
        await publicPage.goto(`/legal/${orgId}?lang=${locale}`);
        await expect(publicPage.locator('html')).toHaveAttribute('lang', locale);
        await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute(
          'content',
          'noindex'
        );
        await expect(
          publicPage.getByRole('heading', { name: t('legal.title'), exact: true })
        ).toBeVisible();
        await expect(publicPage.getByText('Reception Organizer', { exact: true })).toBeVisible();
        await expect(publicPage.getByText(t('legal.request'), { exact: true })).toBeVisible();
        if (javaScriptEnabled)
          expect((await new AxeBuilder({ page: publicPage }).analyze()).violations).toEqual([]);
        await context.close();
      }
      await page.goto(`${eventUrl}?lang=en`);
      const publish = page.getByRole('button', { name: 'Publish event', exact: true });
      if (await publish.count()) {
        await publish.click();
        await expect(page.getByRole('status')).toContainText('updated');
      }
      await expect(page.getByRole('button', { name: 'Publish event', exact: true })).toHaveCount(0);
    });
  });
}
test('unreachable failure and fallback link, offline roster, CSV and print navigation', async ({
  page
}) => {
  await signInAs(page, e2eUsers.sweepOwner);
  await page.getByRole('link', { name: 'Public Fixtures', exact: true }).click();
  await page.getByRole('link', { name: 'Summer Gathering', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);
  const eventUrl = page.url();
  await page.goto(`${eventUrl}/participants?lang=en`);
  const row = page.getByRole('row').filter({ hasText: 'Secured Participant' });
  await expect(row).toContainText('Unreachable');
  await expect(row).toContainText('50007');
  await expect(row.getByRole('link', { name: 'Notification thread', exact: true })).toHaveAttribute(
    'href',
    'https://discord.com/channels/400000000000000001/800000000000000009'
  );
  await page.getByRole('link', { name: 'Check-in', exact: true }).click();
  await page.getByRole('link', { name: 'Offline reception roster', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Secured Participant');
  const numbers = await page.locator('tbody th').allTextContents();
  expect(numbers.map(Number)).toEqual(numbers.map(Number).sort((a, b) => a - b));
  const csv = await page.request.get(`${eventUrl}/check-in/roster.csv?lang=ja`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('受付番号');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ media: 'print' });
  for (const nav of await page.locator('nav').all()) await expect(nav).toBeHidden();
  await expect(page.getByRole('table')).toBeVisible();
});
