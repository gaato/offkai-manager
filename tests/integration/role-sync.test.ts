import { sql } from 'drizzle-orm';
import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
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
import {
  claimRoleSyncEvents,
  processRoleSyncBatch,
  RoleSyncWorker
} from '$lib/server/worker/role-sync';
import { DiscordRateLimitError } from '$lib/server/gateways/discord/rest';
import pino from 'pino';

class RecordingGateway implements DiscordGateway {
  readonly enabled = true;
  readonly calls: {
    operation: 'add' | 'remove';
    userId: string;
  }[] = [];
  constructor(
    private readonly failure?: Error,
    private readonly assertOutsideTransaction: () => void = () => {}
  ) {}
  async isGuildMember(): Promise<boolean> {
    return true;
  }
  async addGuildMemberRole(_guildId: string, userId: string): Promise<void> {
    this.assertOutsideTransaction();
    if (this.failure) throw this.failure;
    this.calls.push({ operation: 'add', userId });
  }
  async removeGuildMemberRole(_guildId: string, userId: string): Promise<void> {
    this.assertOutsideTransaction();
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
  let client: DatabaseClient;
  let ownerId: string;
  let sequence = 0;
  beforeEach(async () => {
    client = testDatabase();
    ownerId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: '130000000000000001',
          username: 'worker-owner',
          displayName: 'Worker Owner',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });
  async function eventWithIntegration(
    mode: 'auto_confirm' | 'approval' = 'approval',
    capacity: number | null = null
  ): Promise<EventSummary> {
    sequence += 1;
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: `Role sync ${sequence}`
      },
      fixedClock
    );
    const event = await createEvent(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: `Role sync event ${sequence}`,
        startsAt: '2027-09-20T18:00',
        capacity,
        registrationMode: mode,
        timeZone: 'Asia/Tokyo'
      },
      undefined,
      fixedClock
    );
    await updateSettings(
      client,
      {
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
      },
      fixedClock
    );
    client.db
      .insert(eventDiscordIntegrations)
      .values({
        createdAt: fixedClock.now(),
        updatedAt: fixedClock.now(),
        eventId: event.id,
        guildId: '130000000000000002',
        guildNameSnapshot: 'Worker Guild',
        roleId: '130000000000000003'
      })
      .run();
    return publishEvent(client, { actorUserId: ownerId, eventId: event.id }, fixedClock);
  }
  async function participant(index: number) {
    const providerUserId = String(13000000000000010n + BigInt(index));
    const username = `worker-participant-${sequence}-${index}`;
    const displayName = `Worker Participant ${sequence}-${index}`;
    const linked = await upsertDiscordIdentity(
      client,
      {
        providerUserId,
        username,
        displayName,
        avatarUrl: ''
      },
      fixedClock
    );
    return { ...linked, providerUserId, username, displayName };
  }

  async function queuedTask() {
    const event = await eventWithIntegration();
    const identity = await participant(99);
    const registration = client.db
      .insert(registrations)
      .values({
        eventId: event.id,
        userId: identity.userId,
        status: 'confirmed',
        displayNameSnapshot: identity.displayName,
        searchText: identity.username,
        createdAt: fixedClock.now(),
        updatedAt: fixedClock.now()
      })
      .returning()
      .get()!;
    return client.db
      .insert(outboxEvents)
      .values({
        type: 'discord.role_sync_requested',
        status: 'pending',
        createdAt: fixedClock.now(),
        payloadJson: { registration_id: registration.id, event_id: event.id }
      })
      .returning()
      .get()!;
  }

  it('resets crash-interrupted processing on startup without losing attempts', async () => {
    const task = await queuedTask();
    expect(claimRoleSyncEvents(client, 1, fixedClock)).toMatchObject([
      { id: task.id, attempts: 1 }
    ]);
    expect(claimRoleSyncEvents(client, 1, fixedClock)).toEqual([]);
    const gateway = new RecordingGateway(undefined, () =>
      expect(client.db.$client.inTransaction).toBe(false)
    );
    const worker = new RoleSyncWorker(
      client,
      gateway,
      pino({ enabled: false }),
      15_000,
      fixedClock
    );
    worker.start();
    await worker.stop();
    expect(
      client.db.select().from(outboxEvents).where(eq(outboxEvents.id, task.id)).get()
    ).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await processRoleSyncBatch(client, gateway, undefined, fixedClock)).toBe(1);
    expect(gateway.calls).toHaveLength(1);
    expect(
      client.db.select().from(outboxEvents).where(eq(outboxEvents.id, task.id)).get()
    ).toMatchObject({ status: 'processed', attempts: 2, processedAt: fixedClock.now() });
  });

  it('honors Discord retry_after using the injected clock, including its exact boundary', async () => {
    const task = await queuedTask();
    const limited = new RecordingGateway(new DiscordRateLimitError(1_500, 'role sync'), () =>
      expect(client.db.$client.inTransaction).toBe(false)
    );
    expect(await processRoleSyncBatch(client, limited, undefined, fixedClock)).toBe(1);
    expect(
      client.db.select().from(outboxEvents).where(eq(outboxEvents.id, task.id)).get()
    ).toMatchObject({
      status: 'pending',
      attempts: 1,
      nextAttemptAt: new Date(fixedClock.now().getTime() + 1_500)
    });
    fixedClock.advance(1_499);
    expect(await processRoleSyncBatch(client, limited, undefined, fixedClock)).toBe(0);
    fixedClock.advance(1);
    const gateway = new RecordingGateway();
    expect(await processRoleSyncBatch(client, gateway, undefined, fixedClock)).toBe(1);
    expect(
      client.db.select().from(outboxEvents).where(eq(outboxEvents.id, task.id)).get()
    ).toMatchObject({ status: 'processed', attempts: 2, nextAttemptAt: null });
  });

  it('gives concurrent claimers disjoint batches and executes every row once', async () => {
    const event = await eventWithIntegration();
    const providerIds: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const identity = await participant(index);
      providerIds.push(identity.providerUserId);
      const rows = client.db
        .insert(registrations)
        .values({
          createdAt: fixedClock.now(),
          updatedAt: fixedClock.now(),
          eventId: event.id,
          userId: identity.userId,
          status: 'confirmed',
          displayNameSnapshot: identity.displayName,
          searchText: identity.username
        })
        .returning({ id: registrations.id })
        .all();
      client.db
        .insert(outboxEvents)
        .values({
          createdAt: fixedClock.now(),
          type: 'discord.role_sync_requested',
          payloadJson: { registration_id: rows[0].id, event_id: event.id },
          status: 'pending'
        })
        .run();
    }
    const gateway = new RecordingGateway();
    const counts = await Promise.all([
      processRoleSyncBatch(client, gateway, undefined, fixedClock),
      processRoleSyncBatch(client, gateway, undefined, fixedClock)
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(12);
    expect(gateway.calls).toHaveLength(12);
    expect(new Set(gateway.calls.map(({ userId }) => userId))).toEqual(new Set(providerIds));
    const eventRows = await client.db.all<{
      status: string;
      attempts: number;
    }>(sql`
      select status, attempts
      from outbox_events
      where payload_json ->> 'event_id' = ${event.id}
    `);
    expect(eventRows).toHaveLength(12);
    expect(eventRows.every((row) => row.status === 'processed' && row.attempts === 1)).toBe(true);
  });
  it('increments attempts and dead-letters a failing task at the fifth claim', async () => {
    const event = await eventWithIntegration();
    const identity = await participant(20);
    const registrationRows = client.db
      .insert(registrations)
      .values({
        createdAt: fixedClock.now(),
        updatedAt: fixedClock.now(),
        eventId: event.id,
        userId: identity.userId,
        status: 'confirmed',
        displayNameSnapshot: identity.displayName,
        searchText: identity.username
      })
      .returning({ id: registrations.id })
      .all();
    const outbox = client.db
      .insert(outboxEvents)
      .values({
        createdAt: fixedClock.now(),
        type: 'discord.role_sync_requested',
        payloadJson: { registration_id: registrationRows[0].id, event_id: event.id },
        status: 'pending'
      })
      .returning({ id: outboxEvents.id })
      .all();
    const gateway = new RecordingGateway(new Error('Discord unavailable'));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(await processRoleSyncBatch(client, gateway, undefined, fixedClock)).toBe(1);
      const rows = client.db
        .select({
          status: outboxEvents.status,
          attempts: outboxEvents.attempts,
          lastError: outboxEvents.lastError
        })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, outbox[0].id))
        .all();
      expect(rows[0]).toMatchObject({
        status: attempt === 5 ? 'failed' : 'pending',
        attempts: attempt,
        lastError: 'Discord unavailable'
      });
    }
    expect(await processRoleSyncBatch(client, gateway, undefined, fixedClock)).toBe(0);
  });
  it('enqueues auto-confirm, manual confirm/cancel, withdrawal, and promotion points', async () => {
    const approval = await eventWithIntegration('approval');
    const approvalParticipant = await participant(30);
    const applied = await createRegistration(
      client,
      {
        organizationSlug: `role-sync-${sequence}`,
        eventSlug: approval.slug,
        userId: approvalParticipant.userId,
        displayName: approvalParticipant.displayName,
        answers: []
      },
      fixedClock
    );
    await changeRegistrationStatus(
      client,
      {
        actorUserId: ownerId,
        registrationId: applied.id,
        status: 'confirmed'
      },
      fixedClock
    );
    await changeRegistrationStatus(
      client,
      {
        actorUserId: ownerId,
        registrationId: applied.id,
        status: 'cancelled'
      },
      fixedClock
    );
    const approvalRows = await client.db.all<{
      registrationId: string;
    }>(sql`
      select payload_json ->> 'registration_id' as "registrationId"
      from outbox_events
      where payload_json ->> 'event_id' = ${approval.id}
      order by created_at asc
    `);
    expect(approvalRows.map(({ registrationId }) => registrationId)).toEqual([
      applied.id,
      applied.id
    ]);
    const automatic = await eventWithIntegration('auto_confirm', 1);
    const firstIdentity = await participant(31);
    const secondIdentity = await participant(32);
    const first = await createRegistration(
      client,
      {
        organizationSlug: `role-sync-${sequence}`,
        eventSlug: automatic.slug,
        userId: firstIdentity.userId,
        displayName: firstIdentity.displayName,
        answers: []
      },
      fixedClock
    );
    const second = await createRegistration(
      client,
      {
        organizationSlug: `role-sync-${sequence}`,
        eventSlug: automatic.slug,
        userId: secondIdentity.userId,
        displayName: secondIdentity.displayName,
        answers: []
      },
      fixedClock
    );
    expect(first.status).toBe('confirmed');
    expect(second.status).toBe('waitlisted');
    client.db
      .delete(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'discord.role_sync_requested'),
          eq(outboxEvents.status, 'pending')
        )
      )
      .run();
    await withdrawRegistration(
      client,
      { registrationId: first.id, userId: firstIdentity.userId },
      fixedClock
    );
    const automaticRows = await client.db.all<{
      registrationId: string;
    }>(sql`
      select payload_json ->> 'registration_id' as "registrationId"
      from outbox_events
      where payload_json ->> 'event_id' = ${automatic.id}
      order by created_at asc, id asc
    `);
    expect(automaticRows.map(({ registrationId }) => registrationId).sort()).toEqual(
      [first.id, second.id].sort()
    );
  });
});
