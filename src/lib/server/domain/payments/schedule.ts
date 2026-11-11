import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { Clock } from '$lib/server/clock';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { collections, events, paymentRequests, registrations } from '$lib/server/db/schema';
import { overduePolicyFromColumns, overdueReleasableAt } from '$lib/shared/overdue-policy';
import { appendAudit } from '../audit';
import { enqueueNotification } from '../notifications/outbox';
import { openMainCollectionInTransaction } from './collections';
import { releaseOverdueRegistration, selectOverdue } from './overdue';

/**
 * Runs payment opening, one-off reminders, the past-due notice and the overdue release that the
 * event's policy announces, inside the worker transaction.
 */
export function tickPaymentSchedule(
  tx: DatabaseTransaction,
  now: Date,
  reminderLeadHours: number,
  clock: Clock
): { opened: number; reminded: number; pastDue: number; overdue: number } {
  let opened = 0;
  let reminded = 0;
  let pastDue = 0;
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
    enqueueNotification(tx, request.registrationId, 'payment_due_soon', clock, {
      perDeadline: true
    });
    reminded++;
  }

  // Past the deadline: tell each unpaid participant once what happens next. An immediate
  // release needs no separate notice because `payment_overdue` follows in the same tick.
  for (const row of selectOverdue(tx, now, { unnotified: true })) {
    const policy = overduePolicyFromColumns(row.event);
    if (policy.kind === 'auto' && policy.graceDays === 0) continue;
    tx.update(paymentRequests)
      .set({ overdueNotifiedAt: now, updatedAt: now })
      .where(and(eq(paymentRequests.id, row.request.id), isNull(paymentRequests.overdueNotifiedAt)))
      .run();
    enqueueNotification(
      tx,
      row.registration.id,
      policy.kind === 'manual' ? 'payment_past_due_manual' : 'payment_past_due',
      clock,
      { perDeadline: true }
    );
    pastDue++;
  }

  for (const row of selectOverdue(tx, now)) {
    const policy = overduePolicyFromColumns(row.event);
    if (policy.kind !== 'auto' || overdueReleasableAt(row.event.paymentDueAt!, policy) > now)
      continue;
    releaseOverdueRegistration(tx, row, null, clock);
    overdue++;
  }
  return { opened, reminded, pastDue, overdue };
}
