import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { REST } from '@discordjs/rest';
import { read, write, type DatabaseClient } from '../db/client';
import { events, eventDiscordIntegrations, discordPanels } from '../db/schema';
import type { Clock } from '../clock';
import type { DiscordGateway } from '../domain/discord/gateway';
import { guildPermissions, hasPermissions } from '../domain/discord/permissions';
import { scheduledPermissions } from '../domain/discord/scheduled';
import { appendAudit } from '../domain/audit';
import { translator } from '$lib/i18n';
const intentSchema = z.object({
  name: z.string(),
  description: z.string(),
  entity_type: z.literal(3),
  privacy_level: z.literal(2),
  scheduled_start_time: z.string(),
  scheduled_end_time: z.string(),
  entity_metadata: z.object({ location: z.string() })
});
export const scheduledStateSchema = z.object({
  guildId: z.string(),
  id: z.string().optional(),
  intent: intentSchema,
  terminal: z.boolean().optional()
});
export async function syncScheduledEvent(
  client: DatabaseClient,
  rest: REST,
  gateway: DiscordGateway,
  eventId: string,
  clock: Clock
) {
  const row = read(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, eventId)).get();
    const integration = tx
      .select()
      .from(eventDiscordIntegrations)
      .where(eq(eventDiscordIntegrations.eventId, eventId))
      .get();
    const panel = tx
      .select()
      .from(discordPanels)
      .where(and(eq(discordPanels.eventId, eventId), isNull(discordPanels.deletedAt)))
      .orderBy(asc(discordPanels.createdAt))
      .get();
    return { event, integration, panel };
  });
  if (!row.event || !row.integration) return;
  const { event, integration, panel } = row;
  let state = integration.scheduledStateJson
    ? scheduledStateSchema.parse(integration.scheduledStateJson)
    : null;
  if (!integration.scheduledEnabled && !state) return;
  const cancel =
    !integration.scheduledEnabled || Boolean(event.cancelledAt) || Boolean(event.archivedAt);
  if (cancel && !state) return;
  const resources = await gateway.getGuildResources?.(state?.guildId ?? integration.guildId);
  if (
    !resources ||
    !hasPermissions(
      guildPermissions(resources.guildId, resources.botRoleIds, resources.roles),
      scheduledPermissions
    )
  )
    throw new Error('scheduled event permissions missing');
  const save = (value: z.infer<typeof scheduledStateSchema>) =>
    write(client, (tx) => {
      tx.update(eventDiscordIntegrations)
        .set({ scheduledStateJson: value, updatedAt: clock.now() })
        .where(eq(eventDiscordIntegrations.eventId, eventId))
        .run();
      appendAudit(
        tx,
        {
          actorUserId: null,
          eventId,
          action: 'discord.scheduled_synced',
          targetType: 'event',
          targetId: eventId,
          after: value
        },
        clock
      );
    });
  if (state?.terminal) return;
  let createdIntent = false;
  if (!state) {
    if (cancel || !panel || event.visibility === 'draft' || event.startsAt <= clock.now()) return;
    state = {
      guildId: integration.guildId,
      intent: {
        name: event.title.slice(0, 100),
        description: `${event.description.slice(0, 700)}\nhttps://discord.com/channels/${panel.guildId}/${panel.channelId}/${panel.messageId}`,
        entity_type: 3,
        privacy_level: 2,
        scheduled_start_time: event.startsAt.toISOString(),
        scheduled_end_time: event.endsAt.toISOString(),
        entity_metadata: {
          location:
            (event.venueReveal === 'public' ? event.venueName : '').slice(0, 100) ||
            translator(panel.locale)('native.tba')
        }
      }
    };
    // Persist ownership intent before POST so a lost response can be recovered by exact body + creator.
    save(state);
    createdIntent = true;
  }
  if (!state.id) {
    const list = createdIntent
      ? []
      : z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().nullable().optional(),
              creator_id: z.string().nullable().optional()
            })
          )
          .parse(await rest.get(`/guilds/${state.guildId}/scheduled-events`));
    const matches = list.filter(
      (e) =>
        e.name === state!.intent.name &&
        e.description === state!.intent.description &&
        e.creator_id === resources.botId
    );
    if (matches.length > 1) throw new Error('ambiguous scheduled event recovery');
    if (matches[0]) state = { ...state, id: matches[0].id };
    else if (cancel) {
      save({ ...state, terminal: true });
      return;
    } else
      state = {
        ...state,
        id: z
          .object({ id: z.string() })
          .parse(
            await rest.post(`/guilds/${state.guildId}/scheduled-events`, { body: state.intent })
          ).id
      };
    save(state);
  }
  let remoteStatus = 1;
  if (!createdIntent) {
    try {
      remoteStatus = z
        .object({ status: z.number().int().min(1).max(4) })
        .parse(await rest.get(`/guilds/${state.guildId}/scheduled-events/${state.id}`)).status;
    } catch (cause) {
      if (cause instanceof DiscordAPIError && cause.status === 404) {
        save({ ...state, terminal: true });
        return;
      }
      throw cause;
    }
    if (remoteStatus === 3 || remoteStatus === 4) {
      save({ ...state, terminal: true });
      return;
    }
  }
  if (cancel && remoteStatus === 2) {
    // Discord forbids ACTIVE -> CANCELED; remove only this recorded owned event.
    await rest.delete(`/guilds/${state.guildId}/scheduled-events/${state.id}`);
    save({ ...state, terminal: true });
    return;
  }
  if (cancel) {
    await rest.patch(`/guilds/${state.guildId}/scheduled-events/${state.id}`, {
      body: { status: 4 }
    });
    save({ ...state, terminal: true });
  } else if (panel && event.startsAt > clock.now()) {
    const body = {
      ...state.intent,
      name: event.title.slice(0, 100),
      description: `${event.description.slice(0, 700)}\nhttps://discord.com/channels/${panel.guildId}/${panel.channelId}/${panel.messageId}`,
      scheduled_start_time: event.startsAt.toISOString(),
      scheduled_end_time: event.endsAt.toISOString(),
      entity_metadata: {
        location:
          (event.venueReveal === 'public' ? event.venueName : '').slice(0, 100) ||
          translator(panel.locale)('native.tba')
      }
    };
    await rest.patch(`/guilds/${state.guildId}/scheduled-events/${state.id}`, { body });
  }
}
