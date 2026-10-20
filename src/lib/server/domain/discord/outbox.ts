import { systemClock, type Clock } from '$lib/server/clock';
import { and, eq, ne } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { eventDiscordIntegrations, outboxEvents } from '$lib/server/db/schema';

/** Enqueues reconciliation only for events bound to a Discord guild. */
export function enqueueRoleSync(
  tx: DatabaseTransaction,
  eventId: string,
  registrationId: string,
  clock: Clock = systemClock
): void {
  const configured = tx
    .select({ id: eventDiscordIntegrations.id })
    .from(eventDiscordIntegrations)
    .where(
      and(eq(eventDiscordIntegrations.eventId, eventId), ne(eventDiscordIntegrations.guildId, ''))
    )
    .limit(1)
    .all();
  if (!configured[0]) return;
  tx.insert(outboxEvents)
    .values({
      createdAt: clock.now(),
      type: 'discord.role_sync_requested',
      payloadJson: { registration_id: registrationId, event_id: eventId },
      status: 'pending'
    })
    .run();
}
