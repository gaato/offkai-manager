import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { Clock } from '$lib/server/clock';
import type { DatabaseTransaction } from '$lib/server/db/client';
import {
  checkinRecords,
  collections,
  events,
  paymentRequests,
  registrations
} from '$lib/server/db/schema';
import { appendAudit } from '../audit';
import { enqueueNotification } from '../notifications/outbox';
import { applyRegistrationEffects, decideRegistration } from '../registrations/lifecycle';
import { openMainCollectionInTransaction } from './collections';
import { cancelPaymentRequestsForRegistration } from './requests';

/** Runs payment opening, one-off reminders, and overdue release inside the worker transaction. */
export function tickPaymentSchedule(
  tx: DatabaseTransaction,
  now: Date,
  reminderLeadHours: number,
  clock: Clock
): { opened: number; reminded: number; overdue: number } {
  let opened = 0;
  let reminded = 0;
  let overdue = 0;

  const scheduled = tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.paymentRequirement, 'pay_later'),
        isNull(events.cancelledAt),
        isNull(events.archivedAt),
        lte(events.paymentOpensAt, now)
      )
    )
    .all();
  for (const event of scheduled) {
    const collection = tx
      .select()
      .from(collections)
      .where(and(eq(collections.eventId, event.id), eq(collections.status, 'draft')))
      .get();
    if (!collection) continue;
    const openedCollection = openMainCollectionInTransaction(
      tx,
      event.id,
      event.paymentDueAt,
      clock
    );
    if (!openedCollection) continue;
    const requests = tx
      .select({ registrationId: paymentRequests.registrationId })
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.collectionId, openedCollection.id),
          inArray(paymentRequests.status, ['pending', 'payment_pending'])
        )
      )
      .all();
    for (const request of requests)
      enqueueNotification(tx, request.registrationId, 'payment_open', clock);
    appendAudit(
      tx,
      {
        actorUserId: null,
        eventId: event.id,
        action: 'payment.schedule_open',
        targetType: 'collection',
        targetId: openedCollection.id,
        after: { requests: requests.length }
      },
      clock
    );
    opened++;
  }

  const reminderThreshold = new Date(now.getTime() + reminderLeadHours * 3_600_000);
  const reminderRows = tx
    .select({ request: paymentRequests, dueAt: events.paymentDueAt })
    .from(paymentRequests)
    .innerJoin(events, eq(events.id, paymentRequests.eventId))
    // Held seats from the additional recruitment pay within their hold, not by the deadline.
    .innerJoin(registrations, eq(registrations.id, paymentRequests.registrationId))
    .where(
      and(
        eq(registrations.status, 'confirmed'),
        isNull(paymentRequests.remindedAt),
        inArray(paymentRequests.status, ['pending', 'payment_pending']),
        isNull(events.cancelledAt),
        isNull(events.archivedAt),
        lte(events.paymentDueAt, reminderThreshold)
      )
    )
    .all();
  for (const { request, dueAt } of reminderRows) {
    if (!dueAt || dueAt <= now) continue;
    tx.update(paymentRequests)
      .set({ remindedAt: now, updatedAt: now })
      .where(and(eq(paymentRequests.id, request.id), isNull(paymentRequests.remindedAt)))
      .run();
    enqueueNotification(tx, request.registrationId, 'payment_due_soon', clock);
    reminded++;
  }

  const overdueRows = tx
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
        lte(events.paymentDueAt, now)
      )
    )
    .all();
  for (const { request, registration, event } of overdueRows) {
    const checkedIn = tx
      .select({ id: checkinRecords.id })
      .from(checkinRecords)
      .where(
        and(
          eq(checkinRecords.registrationId, registration.id),
          eq(checkinRecords.status, 'checked_in')
        )
      )
      .get();
    if (checkedIn) continue;
    const decision = decideRegistration(
      tx,
      event,
      { kind: 'confirmed' },
      { type: 'paymentOverdue' },
      clock,
      registration.id
    );
    tx.update(registrations)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(registrations.id, registration.id), eq(registrations.status, 'confirmed')))
      .run();
    cancelPaymentRequestsForRegistration(tx, registration.id, clock);
    applyRegistrationEffects(
      tx,
      decision,
      {
        actorUserId: null,
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
    overdue++;
  }
  return { opened, reminded, overdue };
}
