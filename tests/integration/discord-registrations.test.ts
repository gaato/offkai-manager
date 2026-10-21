import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { defaultTuning, loadConfig } from '$lib/server/config';
import { read, write, type DatabaseClient } from '$lib/server/db/client';
import {
  discordPanels,
  eventDiscordIntegrations,
  interactionDrafts,
  outboxEvents,
  registrations
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { createRegistration, withdrawRegistration } from '$lib/server/domain/registrations';
import { enqueuePanelRefresh } from '$lib/server/domain/discord/outbox';
import {
  clearInteractionDraft,
  loadInteractionDraft,
  saveInteractionDraft
} from '$lib/server/domain/discord/drafts';
import { updateEventDiscordSettings } from '$lib/server/domain/discord/settings';
import { upsertField, archiveField, addFormPreset } from '$lib/server/domain/events';
import {
  processRoleSyncBatch,
  claimRoleSyncEvents,
  failRoleSyncEvent,
  resetProcessingRoleSyncEvents
} from '$lib/server/worker/role-sync';
import { DisabledDiscordGateway } from '$lib/server/gateways/discord/rest';
import { fixedClock, testDatabase } from '../database';
import { discordEvent } from '../support/discord-registration';
import { recordingRest, responseLike } from '../support/discord-rest';

const gateway = new DisabledDiscordGateway();
describe('Discord registration storage and effects', () => {
  let client: DatabaseClient;
  beforeEach(() => {
    client = testDatabase();
  });
  afterEach(() => {
    client.db.$client.close();
  });
  async function join(
    fixture: Awaited<ReturnType<typeof discordEvent>>,
    userId = fixture.owner.userId
  ) {
    return createRegistration(
      client,
      {
        organizationSlug: fixture.org.slug,
        eventSlug: fixture.event.slug,
        userId,
        displayName: 'Participant',
        answers: []
      },
      fixedClock
    );
  }
  async function panel(
    eventId: string,
    locale: 'ja' | 'en' = 'en',
    messageId = '800000000000000001'
  ) {
    return client.db
      .insert(discordPanels)
      .values({
        eventId,
        guildId: '400000000000000001',
        channelId: '500000000000000001',
        messageId,
        locale,
        createdAt: fixedClock.now()
      })
      .returning()
      .get()!;
  }
  it('numbers are independent per event, unique, and not reused after cancellation', async () => {
    const firstEvent = await discordEvent(client);
    const secondEvent = await discordEvent(client);
    const first = await join(firstEvent);
    expect(first.number).toBe(1);
    await withdrawRegistration(
      client,
      { userId: first.userId, registrationId: first.id },
      fixedClock
    );
    const second = await join(firstEvent);
    expect(second.number).toBe(2);
    expect((await join(secondEvent)).number).toBe(1);
    expect(
      client.db
        .select()
        .from(registrations)
        .where(eq(registrations.eventId, firstEvent.event.id))
        .all()
        .map((r) => r.number)
        .sort()
    ).toEqual([1, 2]);
    expect(() =>
      client.db
        .insert(registrations)
        .values({
          eventId: firstEvent.event.id,
          userId: first.userId,
          number: 1,
          status: 'cancelled',
          displayNameSnapshot: 'Duplicate'
        })
        .run()
    ).toThrow();
  });
  it('serializes reception numbers for concurrent participants', async () => {
    const fixture = await discordEvent(client);
    const users = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        upsertDiscordIdentity(
          client,
          {
            providerUserId: String(900000000000000000n + BigInt(i)),
            username: `user${i}`,
            displayName: `User ${i}`,
            avatarUrl: ''
          },
          fixedClock
        )
      )
    );
    const created = await Promise.all(users.map((user) => join(fixture, user.userId)));
    expect(created.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('drafts are isolated by actor/event/kind and expire at the exact configured boundary', async () => {
    const a = await discordEvent(client),
      b = await discordEvent(client);
    const tuning = loadConfig({
      OFFKAI_AUTH_DEV_BYPASS: 'true',
      OFFKAI_INTERACTION_DRAFT_TTL_SECONDS: '60'
    }).tuning;
    saveInteractionDraft(
      client,
      a.owner.userId,
      a.event.id,
      'join',
      { notes: 'Keep me' },
      fixedClock,
      tuning
    );
    saveInteractionDraft(
      client,
      a.owner.userId,
      a.event.id,
      'edit',
      { notes: 'Edit me' },
      fixedClock,
      tuning
    );
    expect(loadInteractionDraft(client, a.owner.userId, b.event.id, 'join', fixedClock)).toBeNull();
    expect(
      loadInteractionDraft(client, b.owner.userId + 'bad', a.event.id, 'join', fixedClock)
    ).toBeNull();
    fixedClock.advance(59_999);
    expect(loadInteractionDraft(client, a.owner.userId, a.event.id, 'join', fixedClock)).toEqual({
      notes: 'Keep me'
    });
    fixedClock.advance(1);
    expect(loadInteractionDraft(client, a.owner.userId, a.event.id, 'join', fixedClock)).toBeNull();
    expect(client.db.select().from(interactionDrafts).all()).toHaveLength(0);
    saveInteractionDraft(client, a.owner.userId, a.event.id, 'join', { notes: 'New' }, fixedClock);
    clearInteractionDraft(client, a.owner.userId, a.event.id, 'join');
    expect(loadInteractionDraft(client, a.owner.userId, a.event.id, 'join', fixedClock)).toBeNull();
  });
  it('coalesces pending refreshes, preserves a successor during PATCH, and merges rate-limited retries', async () => {
    const fixture = await discordEvent(client);
    write(client, (tx) => {
      for (let i = 0; i < 20; i++) enqueuePanelRefresh(tx, fixture.event.id, fixedClock);
    });
    expect(client.db.select().from(outboxEvents).all()).toHaveLength(1);
    const [claimed] = claimRoleSyncEvents(client, 1, fixedClock);
    write(client, (tx) => enqueuePanelRefresh(tx, fixture.event.id, fixedClock));
    expect(client.db.select().from(outboxEvents).all()).toHaveLength(2);
    failRoleSyncEvent(client, claimed.id, 'rate limited', 100, 500, fixedClock);
    const pending = client.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.status, 'pending'))
      .all();
    expect(pending).toHaveLength(1);
    expect(pending[0].nextAttemptAt).toEqual(new Date(fixedClock.now().getTime() + 500));
  });
  it('recovers interrupted refreshes with pending successors and serializes claims for the same event', async () => {
    const fixture = await discordEvent(client);
    write(client, (tx) => enqueuePanelRefresh(tx, fixture.event.id, fixedClock));
    expect(claimRoleSyncEvents(client, 10, fixedClock)).toHaveLength(1);
    write(client, (tx) => enqueuePanelRefresh(tx, fixture.event.id, fixedClock));
    expect(claimRoleSyncEvents(client, 10, fixedClock)).toHaveLength(0);
    resetProcessingRoleSyncEvents(client);
    expect(
      client.db
        .select()
        .from(outboxEvents)
        .all()
        .filter((row) => row.status === 'pending')
    ).toHaveLength(1);
    expect(claimRoleSyncEvents(client, 10, fixedClock)).toHaveLength(1);
  });
  it('old cancellation jobs preserve the role of a new confirmed registration attempt', async () => {
    const fixture = await discordEvent(client);
    const first = await join(fixture);
    await withdrawRegistration(
      client,
      { userId: first.userId, registrationId: first.id },
      fixedClock
    );
    const second = await join(fixture);
    expect(second.number).toBe(2);
    const recording = {
      enabled: true,
      isGuildMember: gateway.isGuildMember,
      canManageGuild: gateway.canManageGuild,
      getGuildName: gateway.getGuildName,
      addGuildMemberRole: vi.fn(),
      removeGuildMemberRole: vi.fn()
    };
    await processRoleSyncBatch(
      client,
      recording,
      undefined,
      fixedClock,
      defaultTuning,
      recordingRest().rest
    );
    expect(recording.addGuildMemberRole).toHaveBeenCalledTimes(3);
    expect(recording.removeGuildMemberRole).not.toHaveBeenCalled();
  });
  it('skips empty participant roles without a REST call', async () => {
    const fixture = await discordEvent(client);
    client.db
      .update(eventDiscordIntegrations)
      .set({ roleId: '' })
      .where(eq(eventDiscordIntegrations.eventId, fixture.event.id))
      .run();
    await join(fixture);
    const empty = {
      ...gateway,
      enabled: true,
      isGuildMember: vi.fn(),
      canManageGuild: vi.fn(),
      getGuildName: vi.fn(),
      addGuildMemberRole: vi.fn(),
      removeGuildMemberRole: vi.fn()
    };
    const { rest } = recordingRest();
    await processRoleSyncBatch(client, empty, undefined, fixedClock, defaultTuning, rest);
    expect(empty.addGuildMemberRole).not.toHaveBeenCalled();
    expect(empty.removeGuildMemberRole).not.toHaveBeenCalled();
    expect(
      client.db
        .select()
        .from(outboxEvents)
        .all()
        .every((row) => row.status === 'processed')
    ).toBe(true);
  });
  it.each([50013, 10011])(
    'dead-letters permanent role error %s on the first attempt',
    async (code) => {
      const fixture = await discordEvent(client);
      await join(fixture);
      // Use the real REST error decoder through a fake makeRequest transport.
      const { rest } = recordingRest(() =>
        responseLike(
          { code, message: code === 50013 ? 'Missing Permissions' : 'Unknown Role' },
          code === 50013 ? 403 : 404
        )
      );
      const failing = {
        enabled: true,
        isGuildMember: gateway.isGuildMember,
        canManageGuild: gateway.canManageGuild,
        getGuildName: gateway.getGuildName,
        addGuildMemberRole: async () => {
          await rest.put(
            '/guilds/400000000000000001/members/200000000000000001/roles/600000000000000002'
          );
        },
        removeGuildMemberRole: gateway.removeGuildMemberRole
      };
      await processRoleSyncBatch(
        client,
        failing,
        undefined,
        fixedClock,
        defaultTuning,
        recordingRest().rest
      );
      const row = client.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.type, 'discord.role_sync_requested'))
        .get();
      expect(row).toMatchObject({ status: 'failed', attempts: 1 });
      expect(row!.lastError).toContain(String(code));
      expect(
        await processRoleSyncBatch(
          client,
          failing,
          undefined,
          fixedClock,
          defaultTuning,
          recordingRest().rest
        )
      ).toBe(0);
    }
  );
  it('PATCHes all live language panels with latest counts and retires deleted messages', async () => {
    const fixture = await discordEvent(client);
    await panel(fixture.event.id, 'ja');
    await panel(fixture.event.id, 'en', '800000000000000002');
    await join(fixture);
    const { rest, calls } = recordingRest((call) =>
      call.url.includes('800000000000000001')
        ? responseLike({ code: 10008, message: 'Unknown Message' }, 404)
        : responseLike({})
    );
    await processRoleSyncBatch(client, gateway, undefined, fixedClock, defaultTuning, rest);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.method === 'PATCH')).toBe(true);
    expect(JSON.stringify(calls[1].body)).toContain('Confirmed: 1/10');
    expect(
      client.db
        .select()
        .from(discordPanels)
        .all()
        .filter((p) => p.deletedAt)
    ).toHaveLength(1);
  });
  it('RateLimitError reschedules to now + retryAfter instead of sleeping or exhausting attempts', async () => {
    const fixture = await discordEvent(client);
    await panel(fixture.event.id);
    write(client, (tx) => enqueuePanelRefresh(tx, fixture.event.id, fixedClock));
    const { rest } = recordingRest(() =>
      responseLike({ message: 'Rate limited', retry_after: 1.25, global: false }, 429, {
        'Retry-After': '1.25',
        'X-RateLimit-Limit': '1',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset-After': '1.25'
      })
    );
    await processRoleSyncBatch(
      client,
      gateway,
      undefined,
      fixedClock,
      { ...defaultTuning, OFFKAI_OUTBOX_MAX_ATTEMPTS: 1 },
      rest
    );
    expect(client.db.select().from(outboxEvents).get()).toMatchObject({
      status: 'pending',
      attempts: 1,
      nextAttemptAt: new Date(fixedClock.now().getTime() + 1_300)
    });
    expect(
      await processRoleSyncBatch(client, gateway, undefined, fixedClock, defaultTuning, rest)
    ).toBe(0);
    fixedClock.advance(1_300);
    expect(
      await processRoleSyncBatch(
        client,
        gateway,
        undefined,
        fixedClock,
        defaultTuning,
        recordingRest().rest
      )
    ).toBe(1);
  });
  it('rejects a sixth guild question, including presets; archiving frees a slot and editing is allowed', async () => {
    const fixture = await discordEvent(client, {
      fields: Array.from({ length: 5 }, (_, i) => ({ label: `Question ${i}` }))
    });
    const input = {
      actorUserId: fixture.owner.userId,
      eventId: fixture.event.id,
      label: 'Sixth',
      type: 'text' as const,
      required: false
    };
    await expect(upsertField(client, input, fixedClock)).rejects.toMatchObject({
      code: 'validation'
    });
    await expect(
      addFormPreset(
        client,
        {
          actorUserId: input.actorUserId,
          eventId: input.eventId,
          presetKey: 'notes',
          locale: 'en'
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'validation' });
    await upsertField(client, { ...input, fieldId: fixture.fields[0].id }, fixedClock);
    await archiveField(
      client,
      { actorUserId: input.actorUserId, eventId: input.eventId, fieldId: fixture.fields[0].id },
      fixedClock
    );
    await expect(upsertField(client, input, fixedClock)).resolves.toMatchObject({ label: 'Sixth' });
  });
  it('validates and stores staff/log/notification IDs; rejects binding a preexisting oversized form', async () => {
    const fixture = await discordEvent(client, { guild: '' });
    const input = {
      actorUserId: fixture.owner.userId,
      eventId: fixture.event.id,
      policy: 'optional' as const,
      guildId: '400000000000000001',
      inviteUrl: '',
      roleId: '',
      staffRoleId: '600000000000000005',
      logChannelId: '500000000000000002',
      notificationChannelId: '500000000000000003'
    };
    const settings = await updateEventDiscordSettings(client, gateway, input, fixedClock);
    expect(settings.integration).toMatchObject({
      staffRoleId: input.staffRoleId,
      logChannelId: input.logChannelId,
      notificationChannelId: input.notificationChannelId
    });
    await expect(
      updateEventDiscordSettings(client, gateway, { ...input, logChannelId: 'bad' }, fixedClock)
    ).rejects.toMatchObject({ code: 'validation' });
    client.db
      .update(eventDiscordIntegrations)
      .set({ guildId: '' })
      .where(eq(eventDiscordIntegrations.eventId, fixture.event.id))
      .run();
    for (let i = 0; i < 6; i++)
      await upsertField(
        client,
        {
          actorUserId: input.actorUserId,
          eventId: input.eventId,
          label: `Long ${i}`,
          type: 'text',
          required: false
        },
        fixedClock
      );
    await expect(
      updateEventDiscordSettings(client, gateway, input, fixedClock)
    ).rejects.toMatchObject({ code: 'validation' });
    expect(read(client, (tx) => tx.select().from(eventDiscordIntegrations).get()!.guildId)).toBe(
      ''
    );
  });
});
