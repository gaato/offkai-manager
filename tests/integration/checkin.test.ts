import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { auditLogs, checkinRecords, registrations } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  CheckInError,
  getCheckInOverview,
  recordCheckIn,
  undoCheckIn
} from '$lib/server/domain/checkin';
import { createEvent } from '$lib/server/domain/events';
import { createOrganization } from '$lib/server/domain/orgs';

describe('event-day check-in', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let actorUserId: string;
  let eventId: string;
  let registrationId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'checkin-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    actorUserId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '140000000000000001',
        username: 'checkin-owner',
        displayName: 'Check-in Owner',
        avatarUrl: ''
      })
    ).userId;
    const participant = await upsertDiscordIdentity(client, {
      providerUserId: '140000000000000002',
      username: 'arrival-participant',
      displayName: 'Arrival Participant',
      avatarUrl: ''
    });
    const organization = await createOrganization(client, {
      actorUserId,
      name: 'Check-in integration'
    });
    eventId = (
      await createEvent(client, {
        actorUserId,
        organizationId: organization.id,
        title: 'Arrival desk',
        startsAt: '2027-09-20T18:00',
        timeZone: 'Asia/Tokyo'
      })
    ).id;
    const rows = await client.db
      .insert(registrations)
      .values({
        eventId,
        userId: participant.userId,
        status: 'confirmed',
        displayNameSnapshot: 'Arrival Participant',
        searchText: 'Arrival Participant arrival-participant'
      })
      .returning({ id: registrations.id });
    registrationId = rows[0].id;
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  it('serializes duplicate check-in and records one row and one audit', async () => {
    const outcomes = await Promise.allSettled([
      recordCheckIn(client, { actorUserId, registrationId }),
      recordCheckIn(client, { actorUserId, registrationId })
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'duplicate' }
    } satisfies Partial<PromiseRejectedResult>);
    const records = await client.db
      .select()
      .from(checkinRecords)
      .where(eq(checkinRecords.registrationId, registrationId));
    expect(records).toHaveLength(1);
    const audits = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, registrationId));
    expect(audits.filter(({ action }) => action === 'checkin.record')).toHaveLength(1);
  });

  it('shows checked-in state, undoes it, and appends the undo audit', async () => {
    const before = await getCheckInOverview(client, {
      actorUserId,
      eventId,
      query: 'arrival-participant'
    });
    expect(before).toMatchObject({ checkedInCount: 1, confirmedCount: 1 });
    expect(before.rows[0]).toMatchObject({
      registrationId,
      registrationStatus: 'confirmed',
      paymentState: 'none'
    });
    expect(before.rows[0].checkedInAt).toBeInstanceOf(Date);

    await undoCheckIn(client, { actorUserId, registrationId });
    const records = await client.db
      .select()
      .from(checkinRecords)
      .where(eq(checkinRecords.registrationId, registrationId));
    expect(records).toHaveLength(0);
    const audits = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, registrationId));
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['checkin.record', 'checkin.undo'])
    );
    await expect(undoCheckIn(client, { actorUserId, registrationId })).rejects.toMatchObject({
      code: 'not_checked_in'
    } satisfies Partial<CheckInError>);
  });
});
