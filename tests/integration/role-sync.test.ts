import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { eventDiscordIntegrations, outboxEvents, registrations } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import type { DiscordGateway } from '$lib/server/domain/discord';
import {
  createEvent,
  publishEvent,
  updateSettings,
  type EventSummary
} from '$lib/server/domain/events';
import { createOrganization } from '$lib/server/domain/orgs';
import {
  changeRegistrationStatus,
  createRegistration,
  withdrawRegistration
} from '$lib/server/domain/registrations';
import { processRoleSyncBatch } from '$lib/server/worker/role-sync';

class RecordingGateway implements DiscordGateway {
  readonly enabled = true;
  readonly calls: { operation: 'add' | 'remove'; userId: string }[] = [];

  constructor(private readonly failure?: Error) {}

  async isGuildMember(): Promise<boolean> {
    return true;
  }
  async addGuildMemberRole(_guildId: string, userId: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.calls.push({ operation: 'add', userId });
  }
  async removeGuildMemberRole(_guildId: string, userId: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.calls.push({ operation: 'remove', userId });
  }
  async canManageGuild(): Promise<boolean> {
    return true;
  }
  async getGuildName(): Promise<string> {
    return 'Worker Guild';
  }
}

describe('Discord role sync outbox', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'role-sync-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    ownerId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '130000000000000001',
        username: 'worker-owner',
        displayName: 'Worker Owner',
        avatarUrl: ''
      })
    ).userId;
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  async function eventWithIntegration(
    mode: 'auto_confirm' | 'approval' = 'approval',
    capacity: number | null = null
  ): Promise<EventSummary> {
    sequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `Role sync ${sequence}`
    });
    const event = await createEvent(client, {
      actorUserId: ownerId,
      organizationId: organization.id,
      title: `Role sync event ${sequence}`,
      startsAt: '2027-09-20T18:00',
      capacity,
      registrationMode: mode,
      timeZone: 'Asia/Tokyo'
    });
    await updateSettings(client, {
      actorUserId: ownerId,
      eventId: event.id,
      title: event.title,
      description: '',
      startsAt: '2027-09-20T18:00',
      endsAt: '2027-09-20T21:00',
      capacity,
      venueName: '',
      venueAddress: '',
      venueReveal: 'public',
      contact: '',
      cancellationPolicy: '',
      registrationOpensAt: '2026-01-01T00:00',
      registrationClosesAt: '2027-09-20T17:00',
      registrationMode: mode,
      discordPolicy: 'optional',
      timeZone: 'Asia/Tokyo'
    });
    await client.db.insert(eventDiscordIntegrations).values({
      eventId: event.id,
      guildId: '130000000000000002',
      guildNameSnapshot: 'Worker Guild',
      roleId: '130000000000000003'
    });
    return publishEvent(client, { actorUserId: ownerId, eventId: event.id });
  }

  async function participant(index: number) {
    const providerUserId = String(13_000_000_000_000_010n + BigInt(index));
    const username = `worker-participant-${sequence}-${index}`;
    const displayName = `Worker Participant ${sequence}-${index}`;
    const linked = await upsertDiscordIdentity(client, {
      providerUserId,
      username,
      displayName,
      avatarUrl: ''
    });
    return { ...linked, providerUserId, username, displayName };
  }

  it('gives concurrent claimers disjoint batches and executes every row once', async () => {
    const event = await eventWithIntegration();
    const providerIds: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const identity = await participant(index);
      providerIds.push(identity.providerUserId);
      const rows = await client.db
        .insert(registrations)
        .values({
          eventId: event.id,
          userId: identity.userId,
          status: 'confirmed',
          displayNameSnapshot: identity.displayName,
          searchText: identity.username
        })
        .returning({ id: registrations.id });
      await client.db.insert(outboxEvents).values({
        type: 'discord.role_sync_requested',
        payloadJson: { registration_id: rows[0].id, event_id: event.id },
        status: 'pending'
      });
    }
    const gateway = new RecordingGateway();
    const counts = await Promise.all([
      processRoleSyncBatch(client, gateway),
      processRoleSyncBatch(client, gateway)
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(12);
    expect(gateway.calls).toHaveLength(12);
    expect(new Set(gateway.calls.map(({ userId }) => userId))).toEqual(new Set(providerIds));
    const eventRows = await client.sql<{ status: string; attempts: number }[]>`
      select status, attempts
      from outbox_events
      where payload_json ->> 'event_id' = ${event.id}
    `;
    expect(eventRows).toHaveLength(12);
    expect(eventRows.every((row) => row.status === 'processed' && row.attempts === 1)).toBe(true);
  });

  it('increments attempts and dead-letters a failing task at the fifth claim', async () => {
    const event = await eventWithIntegration();
    const identity = await participant(20);
    const registrationRows = await client.db
      .insert(registrations)
      .values({
        eventId: event.id,
        userId: identity.userId,
        status: 'confirmed',
        displayNameSnapshot: identity.displayName,
        searchText: identity.username
      })
      .returning({ id: registrations.id });
    const outbox = await client.db
      .insert(outboxEvents)
      .values({
        type: 'discord.role_sync_requested',
        payloadJson: { registration_id: registrationRows[0].id, event_id: event.id },
        status: 'pending'
      })
      .returning({ id: outboxEvents.id });
    const gateway = new RecordingGateway(new Error('Discord unavailable'));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(await processRoleSyncBatch(client, gateway)).toBe(1);
      const rows = await client.db
        .select({
          status: outboxEvents.status,
          attempts: outboxEvents.attempts,
          lastError: outboxEvents.lastError
        })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, outbox[0].id));
      expect(rows[0]).toMatchObject({
        status: attempt === 5 ? 'failed' : 'pending',
        attempts: attempt,
        lastError: 'Discord unavailable'
      });
    }
    expect(await processRoleSyncBatch(client, gateway)).toBe(0);
  });

  it('enqueues auto-confirm, manual confirm/cancel, withdrawal, and promotion points', async () => {
    const approval = await eventWithIntegration('approval');
    const approvalParticipant = await participant(30);
    const applied = await createRegistration(client, {
      organizationSlug: `role-sync-${sequence}`,
      eventSlug: approval.slug,
      userId: approvalParticipant.userId,
      displayName: approvalParticipant.displayName,
      answers: []
    });
    await changeRegistrationStatus(client, {
      actorUserId: ownerId,
      registrationId: applied.id,
      status: 'confirmed'
    });
    await changeRegistrationStatus(client, {
      actorUserId: ownerId,
      registrationId: applied.id,
      status: 'cancelled'
    });
    const approvalRows = await client.sql<{ registrationId: string }[]>`
      select payload_json ->> 'registration_id' as "registrationId"
      from outbox_events
      where payload_json ->> 'event_id' = ${approval.id}
      order by created_at asc
    `;
    expect(approvalRows.map(({ registrationId }) => registrationId)).toEqual([
      applied.id,
      applied.id
    ]);

    const automatic = await eventWithIntegration('auto_confirm', 1);
    const firstIdentity = await participant(31);
    const secondIdentity = await participant(32);
    const first = await createRegistration(client, {
      organizationSlug: `role-sync-${sequence}`,
      eventSlug: automatic.slug,
      userId: firstIdentity.userId,
      displayName: firstIdentity.displayName,
      answers: []
    });
    const second = await createRegistration(client, {
      organizationSlug: `role-sync-${sequence}`,
      eventSlug: automatic.slug,
      userId: secondIdentity.userId,
      displayName: secondIdentity.displayName,
      answers: []
    });
    expect(first.status).toBe('confirmed');
    expect(second.status).toBe('waitlisted');
    await client.db
      .delete(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'discord.role_sync_requested'),
          eq(outboxEvents.status, 'pending')
        )
      );
    await withdrawRegistration(client, { registrationId: first.id, userId: firstIdentity.userId });
    const automaticRows = await client.sql<{ registrationId: string }[]>`
      select payload_json ->> 'registration_id' as "registrationId"
      from outbox_events
      where payload_json ->> 'event_id' = ${automatic.id}
      order by created_at asc, id asc
    `;
    expect(automaticRows.map(({ registrationId }) => registrationId).sort()).toEqual(
      [first.id, second.id].sort()
    );
  });
});
