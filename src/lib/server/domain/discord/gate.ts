import { and, eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { eventDiscordIntegrations, externalAccounts } from '$lib/server/db/schema';
import type { DiscordPolicy } from '$lib/shared/event';
import type { DiscordGateway } from './gateway';

export interface GuildGateResult {
  allowed: boolean;
  inviteUrl: string;
}

export async function getGuildJoinGuidance(
  client: DatabaseClient,
  eventId: string
): Promise<{ inviteUrl: string }> {
  const rows = await client.db
    .select({ inviteUrl: eventDiscordIntegrations.inviteUrl })
    .from(eventDiscordIntegrations)
    .where(eq(eventDiscordIntegrations.eventId, eventId))
    .limit(1);
  return { inviteUrl: rows[0]?.inviteUrl ?? '' };
}

/** Checks live membership before registration; the registration transaction never calls Discord. */
export async function checkRegistrationGuildGate(
  client: DatabaseClient,
  gateway: DiscordGateway,
  input: { eventId: string; userId: string; policy: DiscordPolicy }
): Promise<GuildGateResult> {
  if (input.policy !== 'guild_join_required' || !gateway.enabled) {
    return { allowed: true, inviteUrl: '' };
  }

  const resolved = await client.db.transaction(async (tx) => {
    const integrations = await tx
      .select({
        guildId: eventDiscordIntegrations.guildId,
        inviteUrl: eventDiscordIntegrations.inviteUrl
      })
      .from(eventDiscordIntegrations)
      .where(eq(eventDiscordIntegrations.eventId, input.eventId))
      .limit(1);
    const integration = integrations[0];
    if (!integration?.guildId) return null;

    const accounts = await tx
      .select({ providerUserId: externalAccounts.providerUserId })
      .from(externalAccounts)
      .where(
        and(eq(externalAccounts.userId, input.userId), eq(externalAccounts.provider, 'discord'))
      )
      .limit(1);
    return {
      guildId: integration.guildId,
      inviteUrl: integration.inviteUrl,
      providerUserId: accounts[0]?.providerUserId ?? ''
    };
  });
  if (!resolved) return { allowed: true, inviteUrl: '' };
  if (!resolved.providerUserId) return { allowed: false, inviteUrl: resolved.inviteUrl };
  return {
    allowed: await gateway.isGuildMember(resolved.guildId, resolved.providerUserId),
    inviteUrl: resolved.inviteUrl
  };
}
