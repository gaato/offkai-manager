import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { systemClock, type Clock } from '$lib/server/clock';
import { read, write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import { checkinRecords, events, paymentRequests, registrations } from '$lib/server/db/schema';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { overduePolicyFromColumns, overdueReleasableAt } from '$lib/shared/overdue-policy';
import { enqueueNotification } from '../notifications/outbox';
import { applyRegistrationEffects, decideRegistration } from '../registrations/lifecycle';
import { afterSeatFreed } from '../registrations/promotion';
import { PaymentError } from './errors';
import { cancelPaymentRequestsForRegistration } from './requests';

type EventRow = typeof events.$inferSelect;
type RegistrationRow = typeof registrations.$inferSelect;
type RequestRow = typeof paymentRequests.$inferSelect;

export interface OverdueRow {
  request: RequestRow;
  registration: RegistrationRow;
  event: EventRow;
}

/**
 * Confirmed attendance whose scheduled deadline has passed with the obligation still unpaid.
 * Held seats from additional recruitment pay within their hold instead, and checked-in
 * attendance is never released, so both are excluded here for every caller.
 */
export function selectOverdue(
  tx: DatabaseTransaction,
  now: Date,
  filter: { eventId?: string; unnotified?: boolean } = {}
): OverdueRow[] {
  return tx
    .select({ request: paymentRequests, registration: registrations, event: events })
    .from(paymentRequests)
    .innerJoin(registrations, eq(registrations.id, paymentRequests.registrationId))
    .innerJoin(events, eq(events.id, paymentRequests.eventId))
    .where(
      and(
        eq(registrations.status, 'confirmed'),
        inArray(paymentRequests.status, ['pending', 'payment_pending']),
        isNull(events.cancelledAt),
        isNull(events.archivedAt),
        lte(events.paymentDueAt, now),
        filter.eventId ? eq(events.id, filter.eventId) : undefined,
        filter.unnotified ? isNull(paymentRequests.overdueNotifiedAt) : undefined
      )
    )
    .all()
    .filter(
      ({ registration }) =>
        !tx
          .select({ id: checkinRecords.id })
          .from(checkinRecords)
          .where(
            and(
              eq(checkinRecords.registrationId, registration.id),
              eq(checkinRecords.status, 'checked_in')
            )
          )
          .get()
    );
}

/**
 * Releases one overdue attendance. The automatic deadline and the organizer's bulk action both
 * come through here, so notification, audit and the vacancy rule cannot drift apart.
 */
export function releaseOverdueRegistration(
  tx: DatabaseTransaction,
  row: OverdueRow,
  actorUserId: string | null,
  clock: Clock
): void {
  const { request, registration, event } = row;
  const decision = decideRegistration(
    tx,
    event,
    { kind: 'confirmed' },
    { type: 'paymentOverdue' },
    clock,
    registration.id
  );
  tx.update(registrations)
    .set({ status: 'cancelled', updatedAt: clock.now() })
    .where(and(eq(registrations.id, registration.id), eq(registrations.status, 'confirmed')))
    .run();
  cancelPaymentRequestsForRegistration(tx, registration.id, clock);
  applyRegistrationEffects(
    tx,
    decision,
    {
      actorUserId,
      eventId: event.id,
      action: 'registration.payment_overdue',
      targetType: 'registration',
      targetId: registration.id,
      before: { status: 'confirmed', paymentRequestId: request.id },
      after: { status: 'cancelled' }
    },
    clock
  );
  enqueueNotification(tx, registration.id, 'payment_overdue', clock);
  afterSeatFreed(tx, event, { actorUserId, reason: 'vacancy after overdue release' }, clock);
}

/** Organizer-visible count of overdue unpaid attendance for an event. */
export function countOverdue(tx: DatabaseTransaction, eventId: string, now: Date): number {
  return selectOverdue(tx, now, { eventId }).length;
}

/**
 * Rows the organizer may release now. A participant whose Checkout is still open is paying right
 * now; cancelling them would only turn the payment into a refund, so they wait for the next try.
 */
function releasable(tx: DatabaseTransaction, eventId: string, now: Date): OverdueRow[] {
  return selectOverdue(tx, now, { eventId }).filter(
    ({ request, event }) =>
      // The announced grace period binds organizers as much as the worker.
      overdueReleasableAt(event.paymentDueAt!, overduePolicyFromColumns(event)) <= now &&
      (request.status !== 'payment_pending' ||
        !request.checkoutExpiresAt ||
        request.checkoutExpiresAt <= now)
  );
}

export interface ReleasableOverdue {
  registrationId: string;
  displayName: string;
}

/** What the confirmation page shows; the action releases exactly these people or nobody. */
export function listReleasableOverdue(
  client: DatabaseClient,
  actorUserId: string,
  eventId: string,
  clock: Clock = systemClock
): ReleasableOverdue[] {
  return read(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, eventId)).get();
    if (!event) throw new PaymentError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'organizer');
    return releasable(tx, eventId, clock.now()).map(({ registration }) => ({
      registrationId: registration.id,
      displayName: registration.displayNameSnapshot
    }));
  });
}

/**
 * The organizer's decision under a manual policy: release the overdue unpaid attendance they
 * confirmed. Automatic events already release on their announced schedule, and releasing earlier
 * would break the rule participants were shown, so the action is limited to manual events. If the
 * set changed since the page was shown (a payment, a check-in undone), nothing is released and
 * the organizer reviews the new list instead of cancelling people they never saw.
 */
export function releaseOverdueRegistrations(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; expectedRegistrationIds: readonly string[] },
  clock: Clock = systemClock
): number {
  return write(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, input.eventId)).get();
    if (!event) throw new PaymentError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, input.actorUserId, 'organizer');
    if (overduePolicyFromColumns(event).kind !== 'manual')
      throw new PaymentError('validation', 'only manual overdue policies release on request');
    const rows = releasable(tx, event.id, clock.now());
    const expected = new Set(input.expectedRegistrationIds);
    if (
      rows.length !== expected.size ||
      rows.some(({ registration }) => !expected.has(registration.id))
    )
      throw new PaymentError('conflict', 'overdue registrations changed since confirmation');
    for (const row of rows) releaseOverdueRegistration(tx, row, input.actorUserId, clock);
    return rows.length;
  });
}
