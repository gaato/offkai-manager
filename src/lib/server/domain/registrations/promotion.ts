import { enqueueNotification } from '../notifications/outbox';
import { systemClock, type Clock } from '$lib/server/clock';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { events, registrations } from '$lib/server/db/schema';
import { decideRegistration, applyRegistrationEffects } from './lifecycle';
import { ensurePaymentRequestsForRegistration } from '$lib/server/domain/payments/requests';

/**
 * The single vacancy rule: every path that frees a confirmed or held seat calls this, whatever
 * the reason (withdrawal, organizer cancellation, hold expiry, late payment, overdue release).
 * Auto-confirm events hand the seat to the oldest waiter until the event starts; approval events
 * leave it to organizers. Without waiters the seat simply reopens to the normal or additional
 * recruitment window, so new applicants never overtake people already waiting.
 */
export function afterSeatFreed(
  tx: DatabaseTransaction,
  event: Pick<
    typeof events.$inferSelect,
    'id' | 'capacity' | 'registrationMode' | 'cancelledAt' | 'archivedAt' | 'startsAt'
  >,
  input: { actorUserId: string | null; reason: string },
  clock: Clock = systemClock
): string | null {
  if (
    event.registrationMode !== 'auto_confirm' ||
    event.cancelledAt ||
    event.archivedAt ||
    clock.now() >= event.startsAt
  )
    return null;
  return promoteOldestWaitlisted(
    tx,
    { eventId: event.id, capacity: event.capacity, ...input },
    clock
  );
}

/** Promotes the oldest waiter inside the caller's write transaction if capacity permits. */
function promoteOldestWaitlisted(
  tx: DatabaseTransaction,
  input: {
    eventId: string;
    capacity: number | null;
    actorUserId: string | null;
    reason: string;
  },
  clock: Clock
): string | null {
  const confirmedRows = tx
    .select({ value: count(registrations.id) })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, input.eventId),
        inArray(registrations.status, ['confirmed', 'held'])
      )
    )
    .all();
  if (input.capacity !== null && (confirmedRows[0]?.value ?? 0) >= input.capacity) return null;
  const waitlistedRows = tx
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, input.eventId), eq(registrations.status, 'waitlisted')))
    .orderBy(asc(registrations.createdAt), asc(registrations.id))
    .limit(1)
    .all();
  const waitlisted = waitlistedRows[0];
  if (!waitlisted) return null;
  const event = tx.select().from(events).where(eq(events.id, input.eventId)).get();
  if (!event) return null;
  const decision = decideRegistration(
    tx,
    event,
    { kind: 'waitlisted' },
    { type: 'promote' },
    clock
  );
  tx.update(registrations)
    .set({
      status: decision.next.kind,
      holdExpiresAt: decision.next.kind === 'held' ? decision.next.holdExpiresAt : null,
      updatedAt: clock.now()
    })
    .where(and(eq(registrations.id, waitlisted.id), eq(registrations.status, 'waitlisted')))
    .run();
  applyRegistrationEffects(
    tx,
    decision,
    {
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      action: 'registration.promote',
      targetType: 'registration',
      targetId: waitlisted.id,
      before: { status: 'waitlisted' },
      after: { status: 'confirmed' },
      reason: input.reason
    },
    clock
  );
  ensurePaymentRequestsForRegistration(tx, input.eventId, waitlisted.id, clock);
  enqueueNotification(tx, waitlisted.id, 'waitlist_confirmed', clock);
  return waitlisted.id;
}
