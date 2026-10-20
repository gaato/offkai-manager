import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { and, eq } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import { eventDiscordIntegrations, events, externalAccounts } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import type { DiscordGateway } from './gateway';
import { discordPolicySchema, type DiscordPolicy } from '$lib/shared/event';

const snowflake = /^\d{17,20}$/;

export interface EventDiscordIntegration {
  id: string;
  eventId: string;
  guildId: string;
  guildNameSnapshot: string;
  inviteUrl: string;
  roleId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventDiscordSettings {
  policy: DiscordPolicy;
  integration: EventDiscordIntegration | null;
}

export interface UpdateDiscordSettingsInput {
  actorUserId: string;
  eventId: string;
  policy: DiscordPolicy;
  guildId: string;
  inviteUrl: string;
  roleId: string;
}

export type DiscordSettingsErrorCode =
  'not_found' | 'forbidden' | 'validation' | 'guild_not_managed' | 'gateway';

export class DiscordSettingsError extends Error {
  constructor(
    readonly code: DiscordSettingsErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'DiscordSettingsError';
  }
}

export async function getEventDiscordSettings(
  client: DatabaseClient,
  actorUserId: string,
  eventId: string
): Promise<EventDiscordSettings> {
  return read(client, (tx) => {
    const event = loadEvent(tx, eventId);
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'viewer', true);
    const integration = loadIntegration(tx, eventId);
    return {
      policy: discordPolicySchema.parse(event.discordPolicy),
      integration: integration ? parseIntegration(integration) : null
    };
  });
}

/** Verifies the guild outside the write transaction, then saves policy, config, and audit atomically. */
export async function updateEventDiscordSettings(
  client: DatabaseClient,
  gateway: DiscordGateway,
  rawInput: UpdateDiscordSettingsInput,
  clock: Clock = systemClock
): Promise<EventDiscordSettings> {
  const input = validateInput(rawInput);
  const preflight = read(client, (tx) => {
    const event = loadEvent(tx, input.eventId);
    authorizeOrganizationRole(tx, event.organizationId, input.actorUserId, 'organizer');
    if (event.archivedAt) {
      throw new DiscordSettingsError('forbidden', 'archived events cannot be changed');
    }
    const providerRows = tx
      .select({ providerUserId: externalAccounts.providerUserId })
      .from(externalAccounts)
      .where(
        and(
          eq(externalAccounts.userId, input.actorUserId),
          eq(externalAccounts.provider, 'discord')
        )
      )
      .limit(1)
      .all();
    return {
      providerUserId: providerRows[0]?.providerUserId ?? '',
      integration: loadIntegration(tx, input.eventId)
    };
  });
  let guildNameSnapshot =
    preflight.integration?.guildId === input.guildId ? preflight.integration.guildNameSnapshot : '';
  if (gateway.enabled && input.guildId) {
    if (!preflight.providerUserId) {
      throw new DiscordSettingsError(
        'guild_not_managed',
        'the actor has no linked Discord identity'
      );
    }
    try {
      if (!(await gateway.canManageGuild(input.guildId, preflight.providerUserId))) {
        throw new DiscordSettingsError(
          'guild_not_managed',
          'the actor cannot manage the Discord guild'
        );
      }
      guildNameSnapshot = await gateway.getGuildName(input.guildId);
    } catch (cause) {
      if (cause instanceof DiscordSettingsError) throw cause;
      throw new DiscordSettingsError('gateway', 'Discord guild verification failed', { cause });
    }
  }
  return write(client, (tx) => {
    const event = loadEvent(tx, input.eventId);
    authorizeOrganizationRole(tx, event.organizationId, input.actorUserId, 'organizer');
    if (event.archivedAt) {
      throw new DiscordSettingsError('forbidden', 'archived events cannot be changed');
    }
    const beforeIntegration = loadIntegration(tx, input.eventId);
    tx.update(events)
      .set({ discordPolicy: input.policy, updatedAt: clock.now() })
      .where(eq(events.id, input.eventId))
      .run();
    const rows = tx
      .insert(eventDiscordIntegrations)
      .values({
        createdAt: clock.now(),
        updatedAt: clock.now(),
        eventId: input.eventId,
        guildId: input.guildId,
        guildNameSnapshot,
        inviteUrl: input.inviteUrl,
        roleId: input.roleId
      })
      .onConflictDoUpdate({
        target: eventDiscordIntegrations.eventId,
        set: {
          guildId: input.guildId,
          guildNameSnapshot,
          inviteUrl: input.inviteUrl,
          roleId: input.roleId,
          updatedAt: clock.now()
        }
      })
      .returning()
      .all();
    const integration = parseIntegration(rows[0]);
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'event.discord_update',
        targetType: 'event_discord_integration',
        targetId: integration.id,
        before: {
          policy: discordPolicySchema.parse(event.discordPolicy),
          integration: integrationAuditSnapshot(beforeIntegration)
        },
        after: {
          policy: input.policy,
          integration: integrationAuditSnapshot(rows[0])
        }
      },
      clock
    );
    return { policy: input.policy, integration };
  });
}

function validateInput(input: UpdateDiscordSettingsInput): UpdateDiscordSettingsInput {
  const policy = discordPolicySchema.safeParse(input.policy);
  if (!policy.success) {
    throw new DiscordSettingsError('validation', 'Discord policy is invalid');
  }
  const guildId = input.guildId.trim();
  const roleId = input.roleId.trim();
  const inviteUrl = input.inviteUrl.trim();
  if (guildId && !snowflake.test(guildId)) {
    throw new DiscordSettingsError('validation', 'Discord guild ID is invalid');
  }
  if (roleId && !snowflake.test(roleId)) {
    throw new DiscordSettingsError('validation', 'Discord role ID is invalid');
  }
  if (inviteUrl) {
    let parsed: URL;
    try {
      parsed = new URL(inviteUrl);
    } catch {
      throw new DiscordSettingsError('validation', 'Discord invite URL is invalid');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new DiscordSettingsError('validation', 'Discord invite URL is invalid');
    }
  }
  if (policy.data === 'guild_join_required' && (!guildId || !inviteUrl)) {
    throw new DiscordSettingsError(
      'validation',
      'guild membership policy requires a guild and invite URL'
    );
  }
  return { ...input, policy: policy.data, guildId, roleId, inviteUrl };
}

function loadEvent(tx: DatabaseTransaction, eventId: string) {
  const query = tx
    .select({
      id: events.id,
      organizationId: events.organizationId,
      discordPolicy: events.discordPolicy,
      archivedAt: events.archivedAt
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const rows = query.all();
  if (!rows[0]) throw new DiscordSettingsError('not_found', 'event not found');
  return rows[0];
}

function loadIntegration(tx: DatabaseTransaction, eventId: string) {
  const rows = tx
    .select()
    .from(eventDiscordIntegrations)
    .where(eq(eventDiscordIntegrations.eventId, eventId))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

function parseIntegration(
  row: typeof eventDiscordIntegrations.$inferSelect
): EventDiscordIntegration {
  return {
    id: row.id,
    eventId: row.eventId,
    guildId: row.guildId,
    guildNameSnapshot: row.guildNameSnapshot,
    inviteUrl: row.inviteUrl,
    roleId: row.roleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function integrationAuditSnapshot(row: typeof eventDiscordIntegrations.$inferSelect | null) {
  return row
    ? {
        guildId: row.guildId,
        guildNameSnapshot: row.guildNameSnapshot,
        inviteUrl: row.inviteUrl,
        roleId: row.roleId
      }
    : null;
}
