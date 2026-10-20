import { systemClock, type Clock } from '$lib/server/clock';
import { and, asc, count, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { registrations } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { enqueueRoleSync } from '$lib/server/domain/discord';
import { ensurePaymentRequestsForRegistration } from '$lib/server/domain/payments';

/** Promotes the oldest waiter inside the caller's write transaction if capacity permits. */
export function promoteOldestWaitlisted(
  tx: DatabaseTransaction,
  input: {
    eventId: string;
    capacity: number | null;
    actorUserId: string;
    reason: string;
  },
  clock: Clock = systemClock
): string | null {
  const confirmedRows = tx
    .select({ value: count(registrations.id) })
    .from(registrations)
    .where(and(eq(registrations.eventId, input.eventId), eq(registrations.status, 'confirmed')))
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
  tx.update(registrations)
    .set({ status: 'confirmed', updatedAt: clock.now() })
    .where(and(eq(registrations.id, waitlisted.id), eq(registrations.status, 'waitlisted')))
    .run();
  appendAudit(
    tx,
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
  enqueueRoleSync(tx, input.eventId, waitlisted.id, clock);
  return waitlisted.id;
}
