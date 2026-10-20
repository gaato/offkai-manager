import { and, asc, count, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { registrations } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { enqueueRoleSync } from '$lib/server/domain/discord';
import { ensurePaymentRequestsForRegistration } from '$lib/server/domain/payments';

/** Promotes the oldest waiter when the caller holds the event row lock and capacity permits. */
export async function promoteOldestWaitlisted(
  tx: DatabaseTransaction,
  input: {
    eventId: string;
    capacity: number | null;
    actorUserId: string;
    reason: string;
  }
): Promise<string | null> {
  const confirmedRows = await tx
    .select({ value: count(registrations.id) })
    .from(registrations)
    .where(and(eq(registrations.eventId, input.eventId), eq(registrations.status, 'confirmed')));
  if (input.capacity !== null && (confirmedRows[0]?.value ?? 0) >= input.capacity) return null;

  const waitlistedRows = await tx
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, input.eventId), eq(registrations.status, 'waitlisted')))
    .orderBy(asc(registrations.createdAt), asc(registrations.id))
    .limit(1)
    .for('update');
  const waitlisted = waitlistedRows[0];
  if (!waitlisted) return null;

  await tx
    .update(registrations)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(and(eq(registrations.id, waitlisted.id), eq(registrations.status, 'waitlisted')));
  await appendAudit(tx, {
    actorUserId: input.actorUserId,
    eventId: input.eventId,
    action: 'registration.promote',
    targetType: 'registration',
    targetId: waitlisted.id,
    before: { status: 'waitlisted' },
    after: { status: 'confirmed' },
    reason: input.reason
  });
  await ensurePaymentRequestsForRegistration(tx, input.eventId, waitlisted.id);
  await enqueueRoleSync(tx, input.eventId, waitlisted.id);
  return waitlisted.id;
}
