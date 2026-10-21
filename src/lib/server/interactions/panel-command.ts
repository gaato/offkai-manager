import { DiscordAPIError, RateLimitError } from '@discordjs/rest';
import { z } from 'zod';
import type { APIInteractionResponse } from 'discord-api-types/v10';
import { systemClock } from '$lib/server/clock';
import { OrganizationError } from '$lib/server/domain/orgs/errors';
import {
  activePanel,
  getManageablePanelEvent,
  PanelError,
  storeDiscordPanel
} from '$lib/server/domain/discord/panels';
import type { Locale, MessageKey } from '$lib/i18n';
import { resolveInteractionUser, type interactionContext } from './context';
import { deferEphemeral, ephemeralReply } from './respond';
import { assertModalFields, ModalLimitError } from './modal';
import { renderPanel } from './renderers';
import type { RouterDependencies } from './router';

export async function postPanel(
  context: ReturnType<typeof interactionContext>,
  dependencies: RouterDependencies,
  eventId: string,
  locale: Locale,
  applicationId: string,
  token: string
): Promise<APIInteractionResponse> {
  if (!context.actor || !context.channelId) return ephemeralReply(context.t('interaction.unknown'));
  const client = dependencies.database();
  const user = await resolveInteractionUser(client, context.actor);
  if (user.suspended) return ephemeralReply(context.t('interaction.unavailable'));
  try {
    const data = getManageablePanelEvent(client, eventId, context.guildId, user.userId);
    assertModalFields(data.fields);
    const existing = activePanel(client, eventId, locale);
    if (existing)
      return ephemeralReply(context.t('panel.exists'), {
        label: context.t('panel.status'),
        url: `https://discord.com/channels/${existing.guildId}/${existing.channelId}/${existing.messageId}`
      });
    const rest = dependencies.rest;
    if (!rest || !dependencies.defer) return ephemeralReply(context.t('panel.failed'));
    const clock = dependencies.clock ?? systemClock;
    const guildId = context.guildId!;
    const channelId = context.channelId;
    dependencies.defer(async () => {
      let messageId: string | undefined;
      let key: MessageKey = 'panel.posted';
      try {
        const message = await rest.post(`/channels/${channelId}/messages`, {
          body: renderPanel(
            data.event,
            { ...data.counts, now: clock.now(), timeZone: dependencies.timeZone },
            locale
          )
        });
        messageId = z.object({ id: z.string().regex(/^\d{17,20}$/) }).parse(message).id;
        storeDiscordPanel(
          client,
          { eventId, userId: user.userId, guildId, channelId, messageId, locale },
          clock
        );
      } catch (cause) {
        key = panelErrorKey(cause);
        // If authorization changed while posting, do not leave an untracked public panel behind.
        if (messageId)
          await rest.delete(`/channels/${channelId}/messages/${messageId}`).catch(() => undefined);
      }
      const response = ephemeralReply(context.t(key));
      await rest.patch(`/webhooks/${applicationId}/${token}/messages/@original`, {
        auth: false,
        body: { ...response.data, flags: 32768 }
      });
    });
    return deferEphemeral();
  } catch (cause) {
    return ephemeralReply(context.t(panelErrorKey(cause)));
  }
}
function panelErrorKey(cause: unknown): MessageKey {
  if (cause instanceof PanelError) return `panel.${cause.code}`;
  if (cause instanceof ModalLimitError) return 'registration_form.discord_limit';
  if (cause instanceof OrganizationError) return 'panel.forbidden';
  if (cause instanceof DiscordAPIError && cause.code === 50013) return 'panel.permission';
  if (cause instanceof RateLimitError) return 'panel.rate_limit';
  return 'panel.failed';
}
