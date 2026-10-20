import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import { systemClock, type Clock } from '$lib/server/clock';
import { read, write, type DatabaseClient } from '$lib/server/db/client';
import {
  eventDiscordIntegrations,
  externalAccounts,
  outboxEvents,
  registrations
} from '$lib/server/db/schema';
import type { DiscordGateway } from '$lib/server/domain/discord';
import { DiscordRateLimitError } from '$lib/server/gateways/discord/rest';

export const roleSyncClaimLimit = 10;
export const roleSyncMaxAttempts = 5;
export const roleSyncIntervalMs = 15_000;

const payloadSchema = z.object({ registration_id: z.uuid(), event_id: z.uuid() });

export interface ClaimedRoleSyncEvent {
  id: string;
  payloadJson: unknown;
  attempts: number;
}

export function resetProcessingRoleSyncEvents(client: DatabaseClient): void {
  write(client, (tx) => {
    tx.update(outboxEvents)
      .set({ status: 'pending', nextAttemptAt: null })
      .where(
        and(
          eq(outboxEvents.type, 'discord.role_sync_requested'),
          eq(outboxEvents.status, 'processing')
        )
      )
      .run();
  });
}

export function claimRoleSyncEvents(
  client: DatabaseClient,
  limit = roleSyncClaimLimit,
  clock: Clock = systemClock
): ClaimedRoleSyncEvent[] {
  return write(client, (tx) => {
    const due = tx
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'discord.role_sync_requested'),
          eq(outboxEvents.status, 'pending'),
          or(isNull(outboxEvents.nextAttemptAt), lte(outboxEvents.nextAttemptAt, clock.now()))
        )
      )
      .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
      .limit(Math.max(1, Math.floor(limit)))
      .all();
    if (!due.length) return [];
    return tx
      .update(outboxEvents)
      .set({
        status: 'processing',
        attempts: sql`${outboxEvents.attempts} + 1`,
        nextAttemptAt: null
      })
      .where(
        inArray(
          outboxEvents.id,
          due.map(({ id }) => id)
        )
      )
      .returning({
        id: outboxEvents.id,
        payloadJson: outboxEvents.payloadJson,
        attempts: outboxEvents.attempts
      })
      .all();
  });
}

export async function processRoleSyncBatch(
  client: DatabaseClient,
  gateway: DiscordGateway,
  logger?: Logger,
  clock: Clock = systemClock
): Promise<number> {
  const claimed = claimRoleSyncEvents(client, undefined, clock);
  for (const event of claimed) {
    try {
      const task = resolveRoleSyncTask(client, event.payloadJson);
      if (task?.guildId && task.roleId && task.discordUserId) {
        if (task.status === 'confirmed') {
          await gateway.addGuildMemberRole(task.guildId, task.discordUserId, task.roleId);
        } else {
          await gateway.removeGuildMemberRole(task.guildId, task.discordUserId, task.roleId);
        }
      }
      write(client, (tx) => {
        tx.update(outboxEvents)
          .set({ status: 'processed', processedAt: clock.now(), nextAttemptAt: null })
          .where(eq(outboxEvents.id, event.id))
          .run();
      });
    } catch (cause) {
      logger?.warn(
        { err: cause, outbox_event_id: event.id, attempts: event.attempts },
        'Discord role sync attempt failed'
      );
      failRoleSyncEvent(
        client,
        event.id,
        cause instanceof Error ? cause.message : String(cause),
        roleSyncMaxAttempts,
        cause instanceof DiscordRateLimitError ? cause.retryAfterMs : 0,
        clock
      );
    }
  }
  return claimed.length;
}

export function failRoleSyncEvent(
  client: DatabaseClient,
  id: string,
  reason: string,
  maxAttempts = roleSyncMaxAttempts,
  retryAfterMs = 0,
  clock: Clock = systemClock
): void {
  write(client, (tx) => {
    const row = tx
      .select({ attempts: outboxEvents.attempts })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .get();
    if (!row) return;
    const failed = row.attempts >= maxAttempts;
    const delay = Math.max(0, Math.floor(retryAfterMs));
    tx.update(outboxEvents)
      .set({
        lastError: reason.slice(0, 2_000),
        status: failed ? 'failed' : 'pending',
        nextAttemptAt: !failed && delay > 0 ? new Date(clock.now().getTime() + delay) : null
      })
      .where(eq(outboxEvents.id, id))
      .run();
  });
}

function resolveRoleSyncTask(client: DatabaseClient, rawPayload: unknown) {
  const payload = payloadSchema.parse(rawPayload);
  return read(client, (tx) =>
    tx
      .select({
        status: registrations.status,
        guildId: eventDiscordIntegrations.guildId,
        roleId: eventDiscordIntegrations.roleId,
        discordUserId: externalAccounts.providerUserId
      })
      .from(registrations)
      .leftJoin(
        eventDiscordIntegrations,
        eq(eventDiscordIntegrations.eventId, registrations.eventId)
      )
      .leftJoin(
        externalAccounts,
        and(
          eq(externalAccounts.userId, registrations.userId),
          eq(externalAccounts.provider, 'discord')
        )
      )
      .where(
        and(
          eq(registrations.id, payload.registration_id),
          eq(registrations.eventId, payload.event_id)
        )
      )
      .get()
  );
}

export class RoleSyncWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly client: DatabaseClient,
    private readonly gateway: DiscordGateway,
    private readonly logger: Logger,
    private readonly intervalMs = roleSyncIntervalMs,
    private readonly clock: Clock = systemClock
  ) {}

  start(): void {
    if (this.timer) return;
    resetProcessingRoleSyncEvents(this.client);
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
    this.inFlight = processRoleSyncBatch(this.client, this.gateway, this.logger, this.clock)
      .then(() => undefined)
      .catch((cause: unknown) => {
        this.logger.error({ err: cause }, 'Discord role sync pass failed');
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}
