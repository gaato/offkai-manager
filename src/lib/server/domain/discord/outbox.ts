import { systemClock, type Clock } from '$lib/server/clock';
import { and, eq, ne, isNull } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { discordPanels, eventDiscordIntegrations, outboxEvents } from '$lib/server/db/schema';

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

/** Only pending refreshes coalesce: a join during an in-flight PATCH needs a successor. */
export function enqueuePanelRefresh(
  tx: DatabaseTransaction,
  eventId: string,
  clock: Clock = systemClock
): void {
  const configured = tx
    .select({ id: eventDiscordIntegrations.id })
    .from(eventDiscordIntegrations)
    .where(
      and(eq(eventDiscordIntegrations.eventId, eventId), ne(eventDiscordIntegrations.guildId, ''))
    )
    .get();
  if (!configured) return;
  tx.insert(outboxEvents)
    .values({
      type: 'panel.refresh',
      dedupeKey: `panel.refresh:${eventId}`,
      payloadJson: { event_id: eventId },
      status: 'pending',
      createdAt: clock.now()
    })
    .onConflictDoNothing()
    .run();
}

/** Event settings only need a refresh once there is a public panel to update. */
export function enqueueExistingPanelRefresh(
  tx: DatabaseTransaction,
  eventId: string,
  clock: Clock = systemClock
): void {
  const integration = tx
    .select()
    .from(eventDiscordIntegrations)
    .where(eq(eventDiscordIntegrations.eventId, eventId))
    .get();
  if (
    integration?.scheduledEnabled ||
    integration?.scheduledStateJson ||
    tx
      .select({ id: discordPanels.id })
      .from(discordPanels)
      .where(and(eq(discordPanels.eventId, eventId), isNull(discordPanels.deletedAt)))
      .get()
  )
    enqueuePanelRefresh(tx, eventId, clock);
}
