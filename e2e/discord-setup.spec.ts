import { expect, test } from '@playwright/test';
import { signInAs } from './auth';
import { discordSetupFixture as fixture, e2eUsers } from './fixtures';

for (const javaScriptEnabled of [true, false]) {
  test.describe(`Discord preparation (JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'})`, () => {
    test.use({ javaScriptEnabled });
    test('Discord pickers, hierarchy warning, safe layout preview, template validation, copy, and preparation checklist', async ({
      page
    }) => {
      await signInAs(page, e2eUsers.sweepOwner, `/app/events/${fixture.eventId}/settings`);
      await expect(page.getByLabel('Panel / announcement channel')).toHaveValue(fixture.channelId);
      await expect(page.getByLabel('Participant role', { exact: true })).toHaveValue(
        fixture.highRoleId
      );
      await expect(
        page.getByRole('alert').filter({ hasText: /The bot cannot assign Above the bot/ })
      ).toBeVisible();
      const adminMessage = page.getByLabel('Message for your server admin (select and copy)');
      await expect(adminMessage).toHaveValue(/Server Settings → Integrations/);
      await page.getByRole('button', { name: 'Preview recommended layout' }).click();
      await expect(
        page.getByText(`Create announcements-panel-${fixture.eventId}`, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText(`Create staff-log-${fixture.eventId}`, { exact: true })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apply this layout plan' })).toBeVisible();
      await page.getByLabel('English panel body', { exact: true }).fill('Invalid {unknown}');
      await page.getByRole('button', { name: 'Save and mark templates reviewed' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: /Unknown template variable/ })
      ).toBeVisible();
      await page.getByLabel('English panel body', { exact: true }).fill('Copied panel {title}');
      await page.getByRole('button', { name: 'Save and mark templates reviewed' }).click();
      await expect(page.getByText('Panel templates saved.', { exact: true })).toBeVisible();

      // The source belongs to a dedicated seeded group; no shared sweep events are mutated.
      await page.goto('/app');
      // The shell navigation and dashboard card intentionally link to the same group.
      await page
        .getByRole('main')
        .getByRole('link', { name: new RegExp(fixture.organizationName) })
        .click();
      await page.getByRole('link', { name: 'Create event', exact: true }).first().click();
      await page.getByLabel('Copy from a previous event').selectOption(fixture.eventId);
      await page.getByLabel('Event title', { exact: true }).fill('Copied Discord Event');
      await page.getByLabel('Start date and time').fill('2028-01-01T18:00');
      await page.getByRole('button', { name: 'Create event', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]+$/);
      const checklist = page.locator('ul.steps');
      await expect(
        checklist.getByRole('link', { name: 'Link Discord', exact: true })
      ).toBeVisible();
      await expect(checklist.locator('li').nth(0)).toHaveClass(/step-primary/);
      await expect(checklist.locator('li').nth(1)).not.toHaveClass(/step-primary/);
      await expect(checklist.locator('li').nth(2)).not.toHaveClass(/step-primary/);
      await expect(page.getByText('Confirmed / capacity', { exact: true })).toBeVisible();
      await checklist.getByRole('link', { name: 'Review panel templates', exact: true }).click();
      await expect(page.getByLabel('English panel body', { exact: true })).toHaveValue(
        'Copied panel {title}'
      );
      await expect(page.getByLabel('Venue name', { exact: true })).toHaveValue('Copied Hall');
      await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue('25');
      await expect(page.getByLabel('Panel / announcement channel')).toHaveValue(fixture.channelId);
      await page.getByRole('link', { name: 'Registration form', exact: true }).click();
      await expect(page.getByText('Copied question', { exact: true })).toBeVisible();
    });
  });
}
