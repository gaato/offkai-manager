import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getConfig, resetConfigForTests } from '$lib/server/config';
import { closeDatabase, getDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { eventDiscordIntegrations, discordLayoutResources } from '$lib/server/db/schema';
import { getDiscordSetup, applyDiscordLayout } from '$lib/server/domain/discord/setup';
import { createEvent, publishEvent, updatePanelTemplates } from '$lib/server/domain/events';
import { getEventDashboard } from '$lib/server/domain/events/dashboard';
import { DiscordRestGateway } from '$lib/server/gateways/discord/rest';
import * as restModule from '$lib/server/interactions/rest';
import { processRoleSyncBatch } from '$lib/server/worker/role-sync';
import { discordEvent } from '../support/discord-registration';
import { fakeDiscordFetch } from '../support/discord-setup';
import { recordingRest } from '../support/discord-rest';
import { callInteraction, makeChatInput } from '../support/interactions';
import { fixedClock } from '../database';
import { signingKey } from '../support/scenario-setup';

let client: DatabaseClient;
beforeEach(() => {
  vi.stubEnv('OFFKAI_DISCORD_BOT_TOKEN', 'fake-test-token');
  resetConfigForTests();
  client = getDatabaseClient(getConfig());
  runMigrations(client);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase(client);
});
it('prepares a server through fake REST, resumes layout setup, copies an event, posts and refreshes its customized panel', async () => {
  const source = await discordEvent(client);
  const fake = fakeDiscordFetch();
  const gateway = new DiscordRestGateway('fake-token', { fetch: fake.fetch });
  const args = [client, gateway, source.owner.userId, source.event.id] as const;
  const first = await getDiscordSetup(...args);
  fake.control.failAt = 6;
  await expect(
    applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock)
  ).rejects.toThrow();
  expect(
    client.db
      .select()
      .from(discordLayoutResources)
      .all()
      .filter((row) => row.discordId)
  ).toHaveLength(5);
  const resume = await getDiscordSetup(...args);
  await applyDiscordLayout(...args, resume.layout!.fingerprint, fixedClock);
  const copy = await createEvent(
    client,
    {
      actorUserId: source.owner.userId,
      organizationId: source.org.id,
      copyFromEventId: source.event.id,
      title: 'Next meetup',
      startsAt: '2027-02-01T12:00',
      timeZone: 'Asia/Tokyo'
    },
    undefined,
    fixedClock
  );
  const copiedSettings = client.db
    .select()
    .from(eventDiscordIntegrations)
    .where(eq(eventDiscordIntegrations.eventId, copy.id))
    .get()!;
  expect(copiedSettings.announcementChannelId).not.toBe('');
  updatePanelTemplates(
    client,
    {
      actorUserId: source.owner.userId,
      eventId: copy.id,
      panelTemplateJa: '次回 {title}',
      panelTemplateEn: 'Next: {title} at {venue}'
    },
    fixedClock
  );
  await publishEvent(client, { actorUserId: source.owner.userId, eventId: copy.id }, fixedClock);
  const transport = recordingRest();
  vi.spyOn(restModule, 'getInteractionRest').mockReturnValue(transport.rest);
  const command = makeChatInput('offkai', 'panel');
  command.channel_id = copiedSettings.announcementChannelId;
  command.data.options = [
    {
      type: 1,
      name: 'panel',
      options: [
        { type: 3, name: 'event', value: copy.id },
        { type: 3, name: 'language', value: 'en' }
      ]
    }
  ];
  const response = await callInteraction(command, signingKey.privateKey);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ type: 5 });
  await vi.waitFor(() =>
    expect(
      getEventDashboard(client, source.owner.userId, copy.id).steps.every((step) => step.done)
    ).toBe(true)
  );
  const posted = transport.calls.find(
    (call) => call.method === 'POST' && call.url.includes('/messages')
  )!;
  expect(JSON.stringify(posted.body)).toContain('Next: Next meetup');
  updatePanelTemplates(
    client,
    {
      actorUserId: source.owner.userId,
      eventId: copy.id,
      panelTemplateJa: '更新 {title}',
      panelTemplateEn: 'Updated: {title}'
    },
    fixedClock
  );
  await processRoleSyncBatch(
    client,
    gateway,
    undefined,
    fixedClock,
    getConfig().tuning,
    transport.rest,
    'Asia/Tokyo'
  );
  expect(
    transport.calls.some(
      (call) =>
        call.method === 'PATCH' && JSON.stringify(call.body).includes('Updated: Next meetup')
    )
  ).toBe(true);
  expect(fake.calls.every((call) => ['GET', 'POST'].includes(call.method))).toBe(true);
});
