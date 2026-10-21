import type { APIInteraction } from 'discord-api-types/v10';
import { normalizeLocale, translator } from '$lib/i18n';
import type { DatabaseClient } from '$lib/server/db/client';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';

export function interactionContext(interaction: Exclude<APIInteraction, { type: 1 }>) {
  const actor = interaction.member?.user ?? interaction.user;
  const locale = normalizeLocale(interaction.locale) ?? 'en';
  return {
    actor,
    locale,
    t: translator(locale),
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    appPermissions: interaction.app_permissions,
    roles: interaction.member?.roles ?? []
  };
}

export async function resolveInteractionUser(
  client: DatabaseClient,
  actor: NonNullable<ReturnType<typeof interactionContext>['actor']>
) {
  return upsertDiscordIdentity(client, {
    providerUserId: actor.id,
    username: actor.username,
    displayName: actor.global_name || actor.username,
    avatarUrl: actor.avatar
      ? `https://cdn.discordapp.com/avatars/${actor.id}/${actor.avatar}.png`
      : ''
  });
}
