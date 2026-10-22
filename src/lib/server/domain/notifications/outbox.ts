import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import type { Clock } from '$lib/server/clock';
import { outboxEvents, registrations } from '$lib/server/db/schema';
export const notificationKinds = [
  'payment_reminder',
  'payment_confirmed',
  'payment_open',
  'payment_due_soon',
  'payment_overdue',
  'hold_expiring',
  'hold_expired',
  'waitlist_confirmed'
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export function enqueueNotification(
  tx: DatabaseTransaction,
  registrationId: string,
  kind: NotificationKind,
  clock: Clock
) {
  const row = tx.select().from(registrations).where(eq(registrations.id, registrationId)).get();
  if (!row) return;
  tx.insert(outboxEvents)
    .values({
      type: 'notify',
      dedupeKey: `notify:${registrationId}:${kind}`,
      payloadJson: { registration_id: registrationId, kind },
      status: 'pending',
      createdAt: clock.now()
    })
    .onConflictDoNothing()
    .run();
}
