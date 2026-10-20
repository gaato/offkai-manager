import { and, asc, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import {
  checkinRecords,
  events,
  externalAccounts,
  paymentRequests,
  registrations
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import type { CheckInPaymentState } from '$lib/shared/checkin';
import { registrationStatusSchema, type RegistrationStatus } from '$lib/shared/registration';

export interface CheckInRow {
  registrationId: string;
  displayName: string;
  username: string;
  registrationStatus: RegistrationStatus;
  paymentState: CheckInPaymentState;
  checkedInAt: Date | null;
}

export interface CheckInOverview {
  rows: CheckInRow[];
  confirmedCount: number;
  checkedInCount: number;
}

export type CheckInErrorCode = 'not_found' | 'not_confirmed' | 'duplicate' | 'not_checked_in';

export class CheckInError extends Error {
  constructor(
    readonly code: CheckInErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CheckInError';
  }
}

export async function getCheckInOverview(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; query: string }
): Promise<CheckInOverview> {
  return client.db.transaction(async (tx) => {
    const eventRows = await tx
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1);
    if (!eventRows[0]) throw new CheckInError('not_found', 'event not found');
    await authorizeOrganizationRole(
      tx,
      eventRows[0].organizationId,
      input.actorUserId,
      'staff',
      false,
      true
    );

    const query = input.query.trim();
    const registrationRows = await tx
      .select({ registration: registrations, username: externalAccounts.username })
      .from(registrations)
      .leftJoin(
        externalAccounts,
        and(
          eq(externalAccounts.userId, registrations.userId),
          eq(externalAccounts.provider, 'discord')
        )
      )
      .where(
        query
          ? and(
              eq(registrations.eventId, input.eventId),
              ilike(registrations.searchText, `%${query}%`)
            )
          : eq(registrations.eventId, input.eventId)
      )
      .orderBy(asc(registrations.displayNameSnapshot), asc(registrations.id));
    const registrationIds = registrationRows.map(({ registration }) => registration.id);
    const [requestRows, recordRows] =
      registrationIds.length === 0
        ? [[], []]
        : await Promise.all([
            tx
              .select({
                registrationId: paymentRequests.registrationId,
                status: paymentRequests.status
              })
              .from(paymentRequests)
              .where(inArray(paymentRequests.registrationId, registrationIds)),
            tx
              .select({
                registrationId: checkinRecords.registrationId,
                createdAt: checkinRecords.createdAt
              })
              .from(checkinRecords)
              .where(
                and(
                  inArray(checkinRecords.registrationId, registrationIds),
                  eq(checkinRecords.status, 'checked_in')
                )
              )
              .orderBy(desc(checkinRecords.createdAt), desc(checkinRecords.id))
          ]);
    const paymentStatuses = new Map<string, string[]>();
    for (const request of requestRows) {
      const statuses = paymentStatuses.get(request.registrationId) ?? [];
      statuses.push(request.status);
      paymentStatuses.set(request.registrationId, statuses);
    }
    const checkedIn = new Map<string, Date>();
    for (const record of recordRows) {
      if (!checkedIn.has(record.registrationId)) {
        checkedIn.set(record.registrationId, record.createdAt);
      }
    }
    const rows = registrationRows
      .map(({ registration, username }) => ({
        registrationId: registration.id,
        displayName: registration.displayNameSnapshot,
        username: username ?? '',
        registrationStatus: registrationStatusSchema.parse(registration.status),
        paymentState: paymentState(paymentStatuses.get(registration.id) ?? []),
        checkedInAt: checkedIn.get(registration.id) ?? null
      }))
      .sort(
        (left, right) => Number(Boolean(left.checkedInAt)) - Number(Boolean(right.checkedInAt))
      );
    return {
      rows,
      confirmedCount: rows.filter((row) => row.registrationStatus === 'confirmed').length,
      checkedInCount: rows.filter((row) => row.checkedInAt).length
    };
  });
}

export async function recordCheckIn(
  client: DatabaseClient,
  input: { actorUserId: string; registrationId: string }
): Promise<void> {
  await client.db.transaction(async (tx) => {
    const registrationRows = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, input.registrationId))
      .limit(1)
      .for('update');
    const registration = registrationRows[0];
    if (!registration) throw new CheckInError('not_found', 'registration not found');
    const eventRows = await tx
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(eq(events.id, registration.eventId))
      .limit(1);
    if (!eventRows[0]) throw new CheckInError('not_found', 'event not found');
    await authorizeOrganizationRole(tx, eventRows[0].organizationId, input.actorUserId, 'staff');
    if (registration.status !== 'confirmed') {
      throw new CheckInError('not_confirmed', 'registration is not confirmed');
    }
    const existing = await tx
      .select({ id: checkinRecords.id })
      .from(checkinRecords)
      .where(
        and(
          eq(checkinRecords.registrationId, registration.id),
          eq(checkinRecords.status, 'checked_in')
        )
      )
      .limit(1);
    if (existing[0]) throw new CheckInError('duplicate', 'registration is already checked in');
    const records = await tx
      .insert(checkinRecords)
      .values({
        eventId: registration.eventId,
        registrationId: registration.id,
        actorUserId: input.actorUserId,
        status: 'checked_in',
        method: 'search'
      })
      .returning({ id: checkinRecords.id });
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: registration.eventId,
      action: 'checkin.record',
      targetType: 'registration',
      targetId: registration.id,
      after: { checkinRecordId: records[0].id, method: 'search' }
    });
  });
}

export async function undoCheckIn(
  client: DatabaseClient,
  input: { actorUserId: string; registrationId: string }
): Promise<void> {
  await client.db.transaction(async (tx) => {
    const registrationRows = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, input.registrationId))
      .limit(1)
      .for('update');
    const registration = registrationRows[0];
    if (!registration) throw new CheckInError('not_found', 'registration not found');
    const eventRows = await tx
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(eq(events.id, registration.eventId))
      .limit(1);
    if (!eventRows[0]) throw new CheckInError('not_found', 'event not found');
    await authorizeOrganizationRole(tx, eventRows[0].organizationId, input.actorUserId, 'staff');
    const removed = await tx
      .delete(checkinRecords)
      .where(
        and(
          eq(checkinRecords.registrationId, registration.id),
          eq(checkinRecords.status, 'checked_in')
        )
      )
      .returning({ id: checkinRecords.id });
    if (removed.length === 0) {
      throw new CheckInError('not_checked_in', 'registration is not checked in');
    }
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: registration.eventId,
      action: 'checkin.undo',
      targetType: 'registration',
      targetId: registration.id,
      reason: 'staff undo',
      before: { checkedIn: true },
      after: { checkedIn: false }
    });
  });
}

function paymentState(statuses: string[]): CheckInPaymentState {
  const active = statuses.filter((status) => status !== 'cancelled');
  if (active.length === 0) return 'none';
  if (active.some((status) => ['pending', 'payment_pending'].includes(status))) {
    return 'unpaid';
  }
  if (active.some((status) => status === 'paid')) return 'paid';
  if (active.some((status) => status === 'waived')) return 'waived';
  return 'unpaid';
}
