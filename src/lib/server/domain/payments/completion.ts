import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import type { Clock } from '$lib/server/clock';
import { registrations, events } from '$lib/server/db/schema';
import { enqueuePanelRefresh, enqueueRoleSync } from '../discord/outbox';
import { enqueueNotification } from '../notifications/outbox';
import { decide, attendanceState } from '../registrations/core';
import { PaymentError } from './errors';
/** The same admission effects run for Stripe, staff settlement, and waiver. */
export function completeAttendancePayment(
  tx: DatabaseTransaction,
  request: { registrationId: string; eventId: string },
  clock: Clock,
  recordId: string,
  kind: 'paid' | 'waived'
) {
  const registration = tx
    .select()
    .from(registrations)
    .where(eq(registrations.id, request.registrationId))
    .get()!;
  const event = tx.select().from(events).where(eq(events.id, request.eventId)).get()!;
  const decision = decide(
    attendanceState(registration),
    kind === 'paid' ? { type: 'manualPaid', recordId } : { type: 'waive' },
    {
      now: clock.now(),
      opensAt: event.registrationOpensAt,
      closesAt: event.registrationClosesAt,
      startsAt: event.startsAt,
      accepting: !event.cancelledAt && !event.archivedAt,
      capacity: event.capacity,
      confirmedCount: 0,
      registrationMode: 'auto_confirm'
    }
  );
  if (!decision.ok || decision.next.kind !== 'confirmed')
    throw new PaymentError('not_payable', 'attendance cannot accept payment');
  if (registration.status === 'held')
    tx.update(registrations)
      .set({ status: decision.next.kind, holdExpiresAt: null, updatedAt: clock.now() })
      .where(eq(registrations.id, registration.id))
      .run();
  enqueueRoleSync(tx, request.eventId, request.registrationId, clock);
  enqueuePanelRefresh(tx, request.eventId, clock);
  enqueueNotification(tx, request.registrationId, 'payment_confirmed', clock);
}
