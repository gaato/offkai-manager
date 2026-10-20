import type { Logger } from 'pino';
import { z } from 'zod';
import type { DatabaseClient } from '$lib/server/db/client';
import type { DiscordGateway } from '$lib/server/domain/discord';
import { DiscordRateLimitError } from '$lib/server/gateways/discord/rest';

export const roleSyncClaimLimit = 10;
export const roleSyncClaimLeaseMs = 60_000;
export const roleSyncMaxAttempts = 5;
export const roleSyncIntervalMs = 15_000;

const payloadSchema = z.object({
  registration_id: z.uuid(),
  event_id: z.uuid()
});

export interface ClaimedRoleSyncEvent {
  id: string;
  payloadJson: unknown;
  attempts: number;
}

interface RoleSyncTask {
  skip: boolean;
  guildId: string;
  roleId: string;
  discordUserId: string;
  assignRole: boolean;
}

export async function claimRoleSyncEvents(
  client: DatabaseClient,
  limit = roleSyncClaimLimit,
  leaseMs = roleSyncClaimLeaseMs
): Promise<ClaimedRoleSyncEvent[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeLeaseMs = Math.max(1, Math.floor(leaseMs));
  const rows = await client.sql<{ id: string; payloadJson: unknown; attempts: number }[]>`
    update outbox_events
    set claimed_until = now() + (${safeLeaseMs} * interval '1 millisecond'),
        attempts = attempts + 1
    where id in (
      select id
      from outbox_events
      where type = 'discord.role_sync_requested'
        and status = 'pending'
        and (claimed_until is null or claimed_until < now())
      order by created_at asc, id asc
      limit ${safeLimit}
      for update skip locked
    )
    returning id::text as id, payload_json as "payloadJson", attempts
  `;
  return [...rows];
}

export async function processRoleSyncBatch(
  client: DatabaseClient,
  gateway: DiscordGateway,
  logger?: Logger
): Promise<number> {
  const claimed = await claimRoleSyncEvents(client);
  for (const event of claimed) {
    try {
      const task = await resolveRoleSyncTask(client, event.payloadJson);
      if (!task.skip) {
        if (task.assignRole) {
          await gateway.addGuildMemberRole(task.guildId, task.discordUserId, task.roleId);
        } else {
          await gateway.removeGuildMemberRole(task.guildId, task.discordUserId, task.roleId);
        }
      }
      await completeRoleSyncEvent(client, event.id);
    } catch (cause) {
      const reason = errorMessage(cause);
      logger?.warn(
        { err: cause, outbox_event_id: event.id, attempts: event.attempts },
        'Discord role sync attempt failed'
      );
      await failRoleSyncEvent(
        client,
        event.id,
        reason,
        roleSyncMaxAttempts,
        cause instanceof DiscordRateLimitError ? cause.retryAfterMs : 0
      );
    }
  }
  return claimed.length;
}

export async function failRoleSyncEvent(
  client: DatabaseClient,
  id: string,
  reason: string,
  maxAttempts = roleSyncMaxAttempts,
  retryAfterMs = 0
): Promise<void> {
  const message = reason.slice(0, 2_000);
  const delay = Math.max(0, Math.floor(retryAfterMs));
  await client.sql`
    update outbox_events
    set last_error = ${message},
        status = case when attempts >= ${maxAttempts} then 'failed' else 'pending' end,
        claimed_until = case
          when attempts >= ${maxAttempts} then null
          when ${delay} > 0 then now() + (${delay} * interval '1 millisecond')
          else null
        end
    where id = ${id}::uuid
  `;
}

async function completeRoleSyncEvent(client: DatabaseClient, id: string): Promise<void> {
  await client.sql`
    update outbox_events
    set status = 'processed', processed_at = now(), claimed_until = null
    where id = ${id}::uuid
  `;
}

async function resolveRoleSyncTask(
  client: DatabaseClient,
  rawPayload: unknown
): Promise<RoleSyncTask> {
  const payload = payloadSchema.parse(rawPayload);
  const rows = await client.sql<
    {
      status: string;
      eventId: string;
      guildId: string;
      roleId: string;
      discordUserId: string;
    }[]
  >`
    select
      r.status,
      r.event_id::text as "eventId",
      coalesce(i.guild_id, '') as "guildId",
      coalesce(i.role_id, '') as "roleId",
      coalesce(ea.provider_user_id, '') as "discordUserId"
    from registrations r
    left join event_discord_integrations i on i.event_id = r.event_id
    left join external_accounts ea on ea.user_id = r.user_id and ea.provider = 'discord'
    where r.id = ${payload.registration_id}::uuid
      and r.event_id = ${payload.event_id}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.guildId || !row.roleId || !row.discordUserId) {
    return {
      skip: true,
      guildId: '',
      roleId: '',
      discordUserId: '',
      assignRole: false
    };
  }
  return {
    skip: false,
    guildId: row.guildId,
    roleId: row.roleId,
    discordUserId: row.discordUserId,
    assignRole: row.status === 'confirmed'
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class RoleSyncWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly client: DatabaseClient,
    private readonly gateway: DiscordGateway,
    private readonly logger: Logger,
    private readonly intervalMs = roleSyncIntervalMs
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private tick(): void {
    if (this.inFlight) return;
    this.inFlight = processRoleSyncBatch(this.client, this.gateway, this.logger)
      .then(() => undefined)
      .catch((cause: unknown) => {
        this.logger.error({ err: cause }, 'Discord role sync pass failed');
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}
