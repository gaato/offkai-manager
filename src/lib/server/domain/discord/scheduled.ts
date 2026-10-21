import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { read, write, type DatabaseClient } from '$lib/server/db/client';
import { events, eventDiscordIntegrations, externalAccounts } from '$lib/server/db/schema';
import { systemClock, type Clock } from '$lib/server/clock';
import { authorizeOrganizationRole } from '../orgs';
import { appendAudit } from '../audit';
import { enqueuePanelRefresh } from './outbox';
import { DiscordSettingsError } from './settings';
import { guildPermissions, hasPermissions, permissions } from './permissions';
import type { DiscordGateway } from './gateway';
export const scheduledPermissions = permissions.createEvents | permissions.manageEvents;
export async function setScheduledEvent(
  client: DatabaseClient,
  gateway: DiscordGateway,
  eventId: string,
  actorUserId: string,
  enabled: boolean,
  clock: Clock = systemClock
) {
  const initial = read(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, eventId)).get();
    if (!event) throw new DiscordSettingsError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'organizer');
    const integration = tx
      .select()
      .from(eventDiscordIntegrations)
      .where(eq(eventDiscordIntegrations.eventId, eventId))
      .get();
    if (!integration?.guildId || event.archivedAt || event.cancelledAt)
      throw new DiscordSettingsError('validation', 'guild event unavailable');
    const discordUserId = tx
      .select({ id: externalAccounts.providerUserId })
      .from(externalAccounts)
      .where(eq(externalAccounts.userId, actorUserId))
      .get()?.id;
    return { ...integration, discordUserId };
  });
  if (enabled) {
    if (
      !initial.discordUserId ||
      !(await gateway.canManageGuild(initial.guildId, initial.discordUserId))
    )
      throw new DiscordSettingsError('guild_not_managed', 'actor cannot manage guild');
    const resources = await gateway.getGuildResources?.(initial.guildId);
    if (
      !resources ||
      !hasPermissions(
        guildPermissions(resources.guildId, resources.botRoleIds, resources.roles),
        scheduledPermissions
      )
    )
      throw new DiscordSettingsError('forbidden', 'scheduled event permissions missing');
  }
  write(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, eventId)).get()!;
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'organizer');
    const integration = tx
      .select()
      .from(eventDiscordIntegrations)
      .where(eq(eventDiscordIntegrations.eventId, eventId))
      .get()!;
    if (integration.guildId !== initial.guildId || event.archivedAt || event.cancelledAt)
      throw new DiscordSettingsError('validation', 'event changed');
    tx.update(eventDiscordIntegrations)
      .set({
        scheduledEnabled: enabled,
        ...(enabled &&
        z.object({ terminal: z.literal(true) }).safeParse(integration.scheduledStateJson).success
          ? { scheduledStateJson: null }
          : {}),
        updatedAt: clock.now()
      })
      .where(eq(eventDiscordIntegrations.eventId, eventId))
      .run();
    appendAudit(
      tx,
      {
        actorUserId,
        eventId,
        action: 'discord.scheduled_setting',
        targetType: 'event',
        targetId: eventId,
        after: { enabled }
      },
      clock
    );
    enqueuePanelRefresh(tx, eventId, clock);
  });
}
