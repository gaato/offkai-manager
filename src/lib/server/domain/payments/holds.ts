import { and, eq, lte } from 'drizzle-orm';
import { write, type DatabaseClient } from '$lib/server/db/client';
import { events, registrations } from '$lib/server/db/schema';
import { defaultTuning, type Tuning } from '$lib/server/config';
import { appendAudit } from '../audit';
import { enqueuePanelRefresh, enqueueRoleSync } from '../discord/outbox';
import { enqueueNotification } from '../notifications/outbox';
import { cancelPaymentRequestsForRegistration } from './requests';
import { promoteOldestWaitlisted } from '../registrations/promotion';

/** One synchronous, deterministic pass; callers supply time and own the timeout loop. */
export function tickOnce(client: DatabaseClient, now: Date, tuning: Tuning = defaultTuning) {
  const clock = { now: () => now };
  return write(client, (tx) => {
    const held = tx.select().from(registrations).where(eq(registrations.status, 'held')).all();
    let released = 0;
    for (const registration of held) {
      if (!registration.holdExpiresAt) throw new Error('hold deadline missing');
      if (registration.holdExpiresAt <= now) {
        tx.update(registrations)
          .set({ status: 'cancelled', holdReleased: true, updatedAt: now })
          .where(
            and(
              eq(registrations.id, registration.id),
              eq(registrations.status, 'held'),
              lte(registrations.holdExpiresAt, now)
            )
          )
          .run();
        cancelPaymentRequestsForRegistration(tx, registration.id, clock);
        enqueuePanelRefresh(tx, registration.eventId, clock);
        enqueueRoleSync(tx, registration.eventId, registration.id, clock);
        enqueueNotification(tx, registration.id, 'hold_expired', clock);
        appendAudit(
          tx,
          {
            actorUserId: null,
            eventId: registration.eventId,
            action: 'registration.hold_expired',
            targetType: 'registration',
            targetId: registration.id,
            before: { status: 'held' },
            after: { status: 'cancelled' }
          },
          clock
        );
        const event = tx.select().from(events).where(eq(events.id, registration.eventId)).get()!;
        if (
          event.registrationMode === 'auto_confirm' &&
          !event.cancelledAt &&
          !event.archivedAt &&
          now < event.startsAt
        )
          promoteOldestWaitlisted(
            tx,
            {
              eventId: event.id,
              capacity: event.capacity,
              actorUserId: registration.userId,
              reason: 'hold expired'
            },
            clock
          );
        released++;
      } else if (
        !registration.holdWarnedAt &&
        registration.holdExpiresAt.getTime() - now.getTime() <=
          tuning.OFFKAI_HOLD_EXPIRING_SOON_MINUTES * 60000
      ) {
        tx.update(registrations)
          .set({ holdWarnedAt: now })
          .where(eq(registrations.id, registration.id))
          .run();
        enqueueNotification(tx, registration.id, 'hold_expiring', clock);
        appendAudit(
          tx,
          {
            actorUserId: null,
            eventId: registration.eventId,
            action: 'registration.hold_expiring',
            targetType: 'registration',
            targetId: registration.id
          },
          clock
        );
      }
    }
    return released;
  });
}
