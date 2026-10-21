import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { testDatabase, fixedClock } from '../database';
import type { DatabaseClient } from '$lib/server/db/client';
import {
  auditLogs,
  discordLayoutResources,
  discordPanels,
  eventDiscordIntegrations,
  eventFormFields,
  eventFormFieldOptions,
  events,
  outboxEvents,
  registrations
} from '$lib/server/db/schema';
import { getDiscordSetup, applyDiscordLayout } from '$lib/server/domain/discord/setup';
import { DiscordRestGateway } from '$lib/server/gateways/discord/rest';
import { updateEventDiscordSettings } from '$lib/server/domain/discord/settings';
import {
  createEvent,
  updatePanelTemplates,
  upsertField,
  archiveField
} from '$lib/server/domain/events';
import { getEventDashboard } from '$lib/server/domain/events/dashboard';
import { createRegistration, withdrawRegistration } from '$lib/server/domain/registrations';
import { createOrganization } from '$lib/server/domain/orgs';
import { discordEvent } from '../support/discord-registration';
import { fakeDiscordFetch, setupGuildId, setupBotRoleId } from '../support/discord-setup';

let client: DatabaseClient;
beforeEach(() => {
  client = testDatabase();
});
afterEach(() => {
  client.db.$client.close();
});
async function fixture() {
  const data = await discordEvent(client);
  const fake = fakeDiscordFetch();
  const gateway = new DiscordRestGateway('fake-token', { fetch: fake.fetch });
  const args = [client, gateway, data.owner.userId, data.event.id] as const;
  return { ...data, fake, gateway, args };
}
describe('Discord organizer setup persistence', () => {
  it('refreshes and stores the REST guild name on load with an atomic audit, only when changed', async () => {
    const { args, event, fake } = await fixture();
    const stored = () =>
      client.db
        .select()
        .from(eventDiscordIntegrations)
        .where(eq(eventDiscordIntegrations.eventId, event.id))
        .get()!;
    const audits = () =>
      client.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'discord.guild_name_refresh'))
        .all();
    client.db
      .update(eventDiscordIntegrations)
      .set({ guildNameSnapshot: '' })
      .where(eq(eventDiscordIntegrations.eventId, event.id))
      .run();
    expect((await getDiscordSetup(...args, fixedClock)).guildNameSnapshot).toBe(
      'Setup Test Server'
    );
    expect(stored().guildNameSnapshot).toBe('Setup Test Server');
    expect(stored().updatedAt).toEqual(fixedClock.now());
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      eventId: event.id,
      createdAt: fixedClock.now(),
      afterJson: { guildNameSnapshot: 'Setup Test Server' }
    });
    await getDiscordSetup(...args, fixedClock);
    expect(audits()).toHaveLength(1);
    fake.control.guildName = 'Renamed Server';
    await getDiscordSetup(...args, fixedClock);
    expect(stored().guildNameSnapshot).toBe('Renamed Server');
    expect(audits()).toHaveLength(2);
    fake.control.unavailable = true;
    await getDiscordSetup(...args, fixedClock);
    expect(stored().guildNameSnapshot).toBe('Renamed Server');
    expect(audits()).toHaveLength(2);
  });
  it('stores the verified guild name when saving guild-only Discord settings without legacy policy requirements', async () => {
    const { event, owner, gateway, fake } = await fixture();
    fake.control.guildName = 'Saved Server Name';
    const saved = await updateEventDiscordSettings(
      client,
      gateway,
      {
        actorUserId: owner.userId,
        eventId: event.id,
        policy: 'not_used',
        guildId: setupGuildId,
        roleId: '',
        inviteUrl: ''
      },
      fixedClock
    );
    expect(saved.integration?.guildNameSnapshot).toBe('Saved Server Name');
    expect(
      client.db
        .select()
        .from(eventDiscordIntegrations)
        .where(eq(eventDiscordIntegrations.eventId, event.id))
        .get()!.guildNameSnapshot
    ).toBe('Saved Server Name');
    expect(fake.calls.some((call) => call.method !== 'GET')).toBe(false);
  });
  it('does not cache a REST name into a different guild linked during the request', async () => {
    const { args, event, gateway } = await fixture();
    const original = gateway.getGuildName.bind(gateway);
    gateway.getGuildName = async (guildId) => {
      const name = await original(guildId);
      client.db
        .update(eventDiscordIntegrations)
        .set({ guildId: '400000000000000099', guildNameSnapshot: 'Other server' })
        .where(eq(eventDiscordIntegrations.eventId, event.id))
        .run();
      return name;
    };
    await getDiscordSetup(...args, fixedClock);
    expect(
      client.db
        .select()
        .from(eventDiscordIntegrations)
        .where(eq(eventDiscordIntegrations.eventId, event.id))
        .get()!.guildNameSnapshot
    ).toBe('Other server');
  });
  it('previews without REST writes; resumes a partial failure without touching pre-existing resources', async () => {
    const { args, fake, event } = await fixture();
    const existing = structuredClone(fake.control.resources);
    const first = await getDiscordSetup(...args);
    expect(fake.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(first.layout!.steps).toHaveLength(8);
    fake.control.failAt = 5;
    await expect(
      applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock)
    ).rejects.toThrow();
    expect(
      client.db
        .select()
        .from(discordLayoutResources)
        .all()
        .filter((row) => row.discordId)
    ).toHaveLength(4);
    const next = await getDiscordSetup(...args);
    expect(next.layout!.steps).toHaveLength(4);
    await applyDiscordLayout(...args, next.layout!.fingerprint, fixedClock);
    const finished = await getDiscordSetup(...args);
    expect(finished.layout!.steps).toEqual([]);
    expect(finished.layout!.existing).toHaveLength(8);
    const posts = fake.calls.filter((call) => call.method === 'POST').length;
    await applyDiscordLayout(...args, finished.layout!.fingerprint, fixedClock);
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(posts);
    expect(fake.calls.every((call) => ['GET', 'POST'].includes(call.method))).toBe(true);
    expect(fake.control.resources.roles.slice(0, existing.roles.length)).toEqual(existing.roles);
    expect(fake.control.resources.channels.slice(0, existing.channels.length)).toEqual(
      existing.channels
    );
    const settings = client.db
      .select()
      .from(eventDiscordIntegrations)
      .where(eq(eventDiscordIntegrations.eventId, event.id))
      .get()!;
    expect(settings.announcementChannelId).not.toBe('');
    expect(settings.paidRoleId).not.toBe('');
    expect(settings.layoutClaim).toBe('');
  });
  it('recovers a lost create response from a durable intent without duplicate creation', async () => {
    const { args, fake } = await fixture();
    const first = await getDiscordSetup(...args);
    fake.control.loseResponseAt = 2;
    await expect(
      applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock)
    ).rejects.toThrow();
    const resumed = await getDiscordSetup(...args);
    expect(resumed.layout!.existing).toHaveLength(2);
    expect(resumed.layout!.steps).toHaveLength(6);
    await applyDiscordLayout(...args, resumed.layout!.fingerprint, fixedClock);
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(8);
    expect((await getDiscordSetup(...args)).layout!.steps).toEqual([]);
    expect(
      client.db
        .select()
        .from(discordLayoutResources)
        .all()
        .every((row) => row.discordId)
    ).toBe(true);
  });
  it('preflights permissions and rejects stale plans and parallel submissions before creating anything', async () => {
    const { args, fake, event } = await fixture();
    const first = await getDiscordSetup(...args);
    fake.control.resources.roles.find((role) => role.id === setupBotRoleId)!.permissions = '0';
    await expect(
      applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock)
    ).rejects.toMatchObject({ code: 'permissions' });
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false);
    fake.control.resources.roles.find((role) => role.id === setupBotRoleId)!.permissions =
      String(8n);
    await expect(applyDiscordLayout(...args, 'wrong', fixedClock)).rejects.toMatchObject({
      code: 'preview_changed'
    });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.control.beforeCreate = async () => {
      entered();
      await paused;
    };
    const apply = applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock);
    await started;
    await expect(
      applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock)
    ).rejects.toMatchObject({ code: 'busy' });
    release();
    await apply;
    expect(
      client.db
        .select()
        .from(discordLayoutResources)
        .where(eq(discordLayoutResources.eventId, event.id))
        .all()
    ).toHaveLength(8);
  });
  it('does not adopt same-name foreign resources and recreates only missing recorded resources', async () => {
    const { args, fake } = await fixture();
    fake.control.resources.channels[0].name = 'announcements-panel';
    const initial = await getDiscordSetup(...args);
    expect(initial.layout!.steps.some((step) => step.kind === 'announcements')).toBe(true);
    await applyDiscordLayout(...args, initial.layout!.fingerprint, fixedClock);
    const finished = await getDiscordSetup(...args);
    const questions = finished.layout!.existing.find((item) => item.kind === 'questions')!;
    fake.control.resources.channels = fake.control.resources.channels.filter(
      (channel) => channel.id !== questions.discordId
    );
    const missing = await getDiscordSetup(...args);
    expect(missing.layout!.steps.map((step) => step.kind)).toEqual(['questions']);
    await applyDiscordLayout(...args, missing.layout!.fingerprint, fixedClock);
    expect((await getDiscordSetup(...args)).layout!.steps).toEqual([]);
  });
  it('replaces dependent owned channels after a role disappears, retains every old ID, and resumes safely', async () => {
    const { args, fake } = await fixture();
    const first = await getDiscordSetup(...args);
    await applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock);
    const resources = client.db.select().from(discordLayoutResources).all();
    const participant = resources.find((row) => row.kind === 'participant')!;
    fake.control.resources.roles = fake.control.resources.roles.filter(
      (role) => role.id !== participant.discordId
    );
    const replacement = await getDiscordSetup(...args);
    expect(replacement.layout!.steps.map((step) => step.kind)).toEqual([
      'participant',
      'category',
      'announcements',
      'questions',
      'notifications',
      'staffLog'
    ]);
    fake.control.loseResponseAt = 10;
    await expect(
      applyDiscordLayout(...args, replacement.layout!.fingerprint, fixedClock)
    ).rejects.toThrow();
    const resume = await getDiscordSetup(...args);
    await applyDiscordLayout(...args, resume.layout!.fingerprint, fixedClock);
    expect((await getDiscordSetup(...args)).layout!.steps).toEqual([]);
    const history = client.db.select().from(discordLayoutResources).all();
    expect(history.filter((row) => row.retiredAt)).toHaveLength(6);
    expect(
      resources.every((old) =>
        history.some((row) => row.id === old.id && row.discordId === old.discordId)
      )
    ).toBe(true);
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(14);
    expect(fake.calls.every((call) => ['GET', 'POST'].includes(call.method))).toBe(true);
  });
  it('allows manual binding before bot installation and preserves feature configuration', async () => {
    const { fake, gateway, owner, event } = await fixture();
    fake.control.unavailable = true;
    const result = await updateEventDiscordSettings(
      client,
      gateway,
      {
        actorUserId: owner.userId,
        eventId: event.id,
        policy: 'optional',
        guildId: setupGuildId,
        inviteUrl: '',
        roleId: '',
        announcementChannelId: '500000000000000001'
      },
      fixedClock
    );
    expect(result.integration?.announcementChannelId).toBe('500000000000000001');
    expect((await getDiscordSetup(client, gateway, owner.userId, event.id)).resources).toBeNull();
    expect(fake.calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it('requires guild-management authority even after manual binding or copying settings', async () => {
    const { args, fake } = await fixture();
    const first = await getDiscordSetup(...args);
    fake.control.ownerId = '200000000000000099';
    await expect(
      applyDiscordLayout(...args, first.layout!.fingerprint, fixedClock)
    ).rejects.toMatchObject({ code: 'guild_not_managed' });
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('rejects unauthorized or archived applies without REST writes', async () => {
    const { args, gateway, fake, owner, event } = await fixture();
    const setup = await getDiscordSetup(...args);
    await expect(
      applyDiscordLayout(
        client,
        gateway,
        'not-a-user',
        event.id,
        setup.layout!.fingerprint,
        fixedClock
      )
    ).rejects.toThrow();
    client.db
      .update(events)
      .set({ archivedAt: fixedClock.now() })
      .where(eq(events.id, event.id))
      .run();
    await expect(
      applyDiscordLayout(
        client,
        gateway,
        owner.userId,
        event.id,
        setup.layout!.fingerprint,
        fixedClock
      )
    ).rejects.toThrow();
    expect(fake.calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('saves reviewed templates atomically with refresh and rejects unknown variables in the domain too', async () => {
    const { owner, event } = await fixture();
    client.db
      .insert(discordPanels)
      .values({
        eventId: event.id,
        guildId: setupGuildId,
        channelId: '500000000000000001',
        messageId: '500000000000000002',
        locale: 'en',
        createdAt: fixedClock.now()
      })
      .run();
    const input = {
      actorUserId: owner.userId,
      eventId: event.id,
      panelTemplateJa: '{title}',
      panelTemplateEn: '{venue}'
    };
    expect(() =>
      updatePanelTemplates(client, { ...input, panelTemplateEn: '{unknown}' }, fixedClock)
    ).toThrow();
    updatePanelTemplates(client, input, fixedClock);
    const saved = client.db.select().from(events).where(eq(events.id, event.id)).get()!;
    expect(saved.panelTemplateReviewedAt).toEqual(fixedClock.now());
    expect(
      client.db.select().from(outboxEvents).where(eq(outboxEvents.type, 'panel.refresh')).all()
    ).toHaveLength(1);
    expect(
      getEventDashboard(client, owner.userId, event.id).steps.map((step) => step.done)
    ).toEqual([true, true, true, true]);
  });
  it('copies only same-organization configuration, resets reception and clears review/lifecycle/participation', async () => {
    const { owner, event, org } = await fixture();
    const joined = await createRegistration(
      client,
      {
        organizationSlug: org.slug,
        eventSlug: event.slug,
        userId: owner.userId,
        displayName: 'Source participant',
        answers: []
      },
      fixedClock
    );
    await withdrawRegistration(
      client,
      { userId: owner.userId, registrationId: joined.id },
      fixedClock
    );
    expect(getEventDashboard(client, owner.userId, event.id).stats.cancelled).toBe(1);
    const archived = await upsertField(
      client,
      {
        actorUserId: owner.userId,
        eventId: event.id,
        label: 'Retired question',
        type: 'text',
        required: false
      },
      fixedClock
    );
    await archiveField(
      client,
      { actorUserId: owner.userId, eventId: event.id, fieldId: archived.id },
      fixedClock
    );

    const field = await upsertField(
      client,
      {
        actorUserId: owner.userId,
        eventId: event.id,
        label: 'Choice',
        type: 'select',
        required: true,
        helpText: 'Pick one',
        optionLabels: ['One', 'Two']
      },
      fixedClock
    );
    updatePanelTemplates(
      client,
      {
        actorUserId: owner.userId,
        eventId: event.id,
        panelTemplateJa: '日本語 {title}',
        panelTemplateEn: 'English {title}'
      },
      fixedClock
    );
    client.db
      .insert(discordPanels)
      .values({
        eventId: event.id,
        guildId: setupGuildId,
        channelId: '500000000000000001',
        messageId: '500000000000000002',
        locale: 'en',
        createdAt: fixedClock.now()
      })
      .run();
    const copy = await createEvent(
      client,
      {
        actorUserId: owner.userId,
        organizationId: org.id,
        copyFromEventId: event.id,
        title: 'Next event',
        startsAt: '2027-02-01T12:00',
        timeZone: 'Asia/Tokyo'
      },
      undefined,
      fixedClock
    );
    expect(copy.capacity).toBe(event.capacity);
    expect(copy.panelTemplateEn).toBe('English {title}');
    expect(copy.panelTemplateReviewedAt).toBeNull();
    expect(copy.visibility).toBe('draft');
    expect(copy.endsAt.getTime() - copy.startsAt.getTime()).toBe(
      event.endsAt.getTime() - event.startsAt.getTime()
    );
    expect(copy.registrationOpensAt).toEqual(fixedClock.now());
    expect(copy.registrationClosesAt).toEqual(copy.startsAt);
    const copiedFields = client.db
      .select()
      .from(eventFormFields)
      .where(eq(eventFormFields.eventId, copy.id))
      .all();
    expect(copiedFields).toHaveLength(1);
    expect(copiedFields[0].id).not.toBe(field.id);
    expect(
      client.db
        .select()
        .from(eventFormFieldOptions)
        .where(eq(eventFormFieldOptions.fieldId, copiedFields[0].id))
        .orderBy(asc(eventFormFieldOptions.position))
        .all()
        .map((row) => row.label)
    ).toEqual(['One', 'Two']);
    expect(
      client.db
        .select()
        .from(eventDiscordIntegrations)
        .where(eq(eventDiscordIntegrations.eventId, copy.id))
        .get()?.guildId
    ).toBe(setupGuildId);
    expect(
      client.db.select().from(discordPanels).where(eq(discordPanels.eventId, copy.id)).all()
    ).toEqual([]);
    expect(
      client.db.select().from(registrations).where(eq(registrations.eventId, copy.id)).all()
    ).toEqual([]);
    expect(
      client.db
        .select()
        .from(discordLayoutResources)
        .where(eq(discordLayoutResources.eventId, copy.id))
        .all()
    ).toEqual([]);
    const other = await createOrganization(
      client,
      { actorUserId: owner.userId, name: 'Other organization' },
      fixedClock
    );
    await expect(
      createEvent(
        client,
        {
          actorUserId: owner.userId,
          organizationId: other.id,
          copyFromEventId: event.id,
          title: 'Invalid copy',
          startsAt: '2027-03-01T12:00',
          timeZone: 'Asia/Tokyo'
        },
        undefined,
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
