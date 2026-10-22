import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
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
import { withdrawRegistration } from '$lib/server/domain/registrations/participant';

describe('event-day check-in', () => {
  let client: DatabaseClient;
  let actorUserId: string;
  let eventId: string;
  let registrationId: string;
  let participantUserId: string;
  beforeEach(async () => {
    client = testDatabase();
    actorUserId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: '140000000000000001',
          username: 'checkin-owner',
          displayName: 'Check-in Owner',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
    const participant = await upsertDiscordIdentity(
      client,
      {
        providerUserId: '140000000000000002',
        username: 'arrival-participant',
        displayName: 'Arrival Participant',
        avatarUrl: ''
      },
      fixedClock
    );
    participantUserId = participant.userId;
    const organization = await createOrganization(
      client,
      {
        actorUserId,
        name: 'Check-in integration'
      },
      fixedClock
    );
    eventId = (
      await createEvent(
        client,
        {
          actorUserId,
          organizationId: organization.id,
          title: 'Arrival desk',
          startsAt: '2027-09-20T18:00',
          timeZone: 'Asia/Tokyo'
        },
        undefined,
        fixedClock
      )
    ).id;
    const rows = client.db
      .insert(registrations)
      .values({
        createdAt: fixedClock.now(),
        updatedAt: fixedClock.now(),
        eventId,
        userId: participant.userId,
        status: 'confirmed',
        displayNameSnapshot: 'Arrival Participant',
        searchText: 'Arrival Participant arrival-participant'
      })
      .returning({ id: registrations.id })
      .all();
    registrationId = rows[0].id;
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });
  it('serializes duplicate check-in and records one row and one audit', async () => {
    const outcomes = await Promise.allSettled([
      recordCheckIn(client, { actorUserId, registrationId }, fixedClock),
      recordCheckIn(client, { actorUserId, registrationId }, fixedClock)
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'duplicate' }
    } satisfies Partial<PromiseRejectedResult>);
    const records = client.db
      .select()
      .from(checkinRecords)
      .where(eq(checkinRecords.registrationId, registrationId))
      .all();
    expect(records).toHaveLength(1);
    const audits = client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, registrationId))
      .all();
    expect(audits.filter(({ action }) => action === 'checkin.record')).toHaveLength(1);
  });
  it('keeps a checked-in attendance until staff undo the check-in', async () => {
    await recordCheckIn(client, { actorUserId, registrationId }, fixedClock);
    const withdraw = () =>
      withdrawRegistration(client, { registrationId, userId: participantUserId }, fixedClock);
    await expect(withdraw()).rejects.toMatchObject({ code: 'checked_in' });
    expect(
      client.db.select().from(registrations).where(eq(registrations.id, registrationId)).get()
        ?.status
    ).toBe('confirmed');
    expect(client.db.select().from(checkinRecords).all()).toHaveLength(1);
    await undoCheckIn(client, { actorUserId, registrationId }, fixedClock);
    expect((await withdraw()).registration.status).toBe('cancelled');
  });
  it('shows checked-in state, undoes it, and appends the undo audit', async () => {
    await recordCheckIn(client, { actorUserId, registrationId }, fixedClock);
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
    await undoCheckIn(client, { actorUserId, registrationId }, fixedClock);
    const records = client.db
      .select()
      .from(checkinRecords)
      .where(eq(checkinRecords.registrationId, registrationId))
      .all();
    expect(records).toHaveLength(0);
    const audits = client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, registrationId))
      .all();
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['checkin.record', 'checkin.undo'])
    );
    await expect(
      undoCheckIn(client, { actorUserId, registrationId }, fixedClock)
    ).rejects.toMatchObject({
      code: 'not_checked_in'
    } satisfies Partial<CheckInError>);
  });
});
