import { and, eq, ne } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { eventDiscordIntegrations, outboxEvents } from '$lib/server/db/schema';

/** Enqueues reconciliation only for events bound to a Discord guild. */
export async function enqueueRoleSync(
  tx: DatabaseTransaction,
  eventId: string,
  registrationId: string
): Promise<void> {
  const configured = await tx
    .select({ id: eventDiscordIntegrations.id })
    .from(eventDiscordIntegrations)
    .where(
      and(eq(eventDiscordIntegrations.eventId, eventId), ne(eventDiscordIntegrations.guildId, ''))
    )
    .limit(1);
  if (!configured[0]) return;
  await tx.insert(outboxEvents).values({
    type: 'discord.role_sync_requested',
    payloadJson: { registration_id: registrationId, event_id: eventId },
    status: 'pending'
  });
}
