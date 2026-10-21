import { DiscordAPIError, RateLimitError, type REST } from '@discordjs/rest';
import { defaultTuning, type Tuning } from '$lib/server/config';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import { systemClock, type Clock } from '$lib/server/clock';
import { read, write, type DatabaseClient } from '$lib/server/db/client';
import {
  discordPanels,
  eventDiscordIntegrations,
  externalAccounts,
  outboxEvents,
  registrations
} from '$lib/server/db/schema';
import type { DiscordGateway } from '$lib/server/domain/discord';
import { loadPanelEvent } from '$lib/server/domain/discord/panels';
import { renderPanel } from '$lib/server/interactions/renderers';
import { DiscordRateLimitError } from '$lib/server/gateways/discord/rest';

const supportedTypes = ['discord.role_sync_requested', 'panel.refresh'];
const payloadSchema = z.object({ registration_id: z.uuid(), event_id: z.uuid() });

export interface ClaimedRoleSyncEvent {
  id: string;
  type: string;
  payloadJson: unknown;
  attempts: number;
}

export function resetProcessingRoleSyncEvents(client: DatabaseClient): void {
  write(client, (tx) => {
    const interrupted = tx
      .select()
      .from(outboxEvents)
      .where(and(inArray(outboxEvents.type, supportedTypes), eq(outboxEvents.status, 'processing')))
      .all();
    for (const row of interrupted) {
      const successor = row.dedupeKey
        ? tx
            .select()
            .from(outboxEvents)
            .where(
              and(eq(outboxEvents.dedupeKey, row.dedupeKey), eq(outboxEvents.status, 'pending'))
            )
            .get()
        : undefined;
      tx.update(outboxEvents)
        .set(successor ? { status: 'processed' } : { status: 'pending', nextAttemptAt: null })
        .where(eq(outboxEvents.id, row.id))
        .run();
    }
  });
}

export function claimRoleSyncEvents(
  client: DatabaseClient,
  limit = defaultTuning.OFFKAI_OUTBOX_BATCH_SIZE,
  clock: Clock = systemClock
): ClaimedRoleSyncEvent[] {
  return write(client, (tx) => {
    const due = tx
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          inArray(outboxEvents.type, supportedTypes),
          eq(outboxEvents.status, 'pending'),
          or(
            isNull(outboxEvents.dedupeKey),
            sql`not exists (select 1 from outbox_events running where running.dedupe_key = ${outboxEvents.dedupeKey} and running.status = 'processing')`
          ),
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
        type: outboxEvents.type,
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
  clock: Clock = systemClock,
  tuning: Tuning = defaultTuning,
  rest?: REST,
  timeZone = 'Asia/Tokyo'
): Promise<number> {
  const claimed = claimRoleSyncEvents(client, tuning.OFFKAI_OUTBOX_BATCH_SIZE, clock);
  for (const event of claimed) {
    try {
      if (event.type === 'panel.refresh') {
        if (!rest) throw new Error('Discord message transport is unavailable');
        await refreshPanels(client, rest, event.payloadJson, clock, timeZone);
      } else {
        const task = resolveRoleSyncTask(client, event.payloadJson);
        if (task?.guildId && task.roleId && task.discordUserId) {
          if (task.status === 'confirmed') {
            await gateway.addGuildMemberRole(task.guildId, task.discordUserId, task.roleId);
          } else {
            await gateway.removeGuildMemberRole(task.guildId, task.discordUserId, task.roleId);
          }
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
        'Discord outbox attempt failed'
      );
      failRoleSyncEvent(
        client,
        event.id,
        cause instanceof DiscordAPIError
          ? `Discord ${cause.code}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : String(cause),
        permanentDiscordFailure(cause)
          ? 1
          : cause instanceof RateLimitError || cause instanceof DiscordRateLimitError
            ? Number.MAX_SAFE_INTEGER
            : tuning.OFFKAI_OUTBOX_MAX_ATTEMPTS,
        cause instanceof RateLimitError
          ? cause.retryAfter
          : cause instanceof DiscordRateLimitError
            ? cause.retryAfterMs
            : 0,
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
  maxAttempts = defaultTuning.OFFKAI_OUTBOX_MAX_ATTEMPTS,
  retryAfterMs = 0,
  clock: Clock = systemClock
): void {
  write(client, (tx) => {
    const row = tx
      .select({ attempts: outboxEvents.attempts, dedupeKey: outboxEvents.dedupeKey })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .get();
    if (!row) return;
    const successor = row.dedupeKey
      ? tx
          .select()
          .from(outboxEvents)
          .where(and(eq(outboxEvents.dedupeKey, row.dedupeKey), eq(outboxEvents.status, 'pending')))
          .get()
      : undefined;
    const failed = row.attempts >= maxAttempts || Boolean(successor && successor.id !== id);
    if (successor && successor.id !== id && retryAfterMs > 0) {
      tx.update(outboxEvents)
        .set({ nextAttemptAt: new Date(clock.now().getTime() + retryAfterMs) })
        .where(eq(outboxEvents.id, successor.id))
        .run();
    }
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
  return read(client, (tx) => {
    const task = tx
      .select({
        userId: registrations.userId,
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
      .get();
    if (!task) return undefined;
    const confirmed = tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, payload.event_id),
          eq(registrations.userId, task.userId),
          eq(registrations.status, 'confirmed')
        )
      )
      .get();
    return { ...task, status: confirmed ? 'confirmed' : task.status };
  });
}

export class RoleSyncWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly client: DatabaseClient,
    private readonly gateway: DiscordGateway,
    private readonly logger: Logger,
    private readonly tuning: Tuning = defaultTuning,
    private readonly clock: Clock = systemClock,
    private readonly rest?: REST,
    private readonly timeZone = 'Asia/Tokyo'
  ) {}

  start(): void {
    if (this.timer) return;
    resetProcessingRoleSyncEvents(this.client);
    this.timer = setInterval(() => this.tick(), this.tuning.OFFKAI_OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private tick(): void {
    if (this.inFlight) return;
    this.inFlight = processRoleSyncBatch(
      this.client,
      this.gateway,
      this.logger,
      this.clock,
      this.tuning,
      this.rest,
      this.timeZone
    )
      .then(() => undefined)
      .catch((cause: unknown) => {
        this.logger.error({ err: cause }, 'Discord outbox pass failed');
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}

function permanentDiscordFailure(cause: unknown): boolean {
  return (
    (cause instanceof DiscordAPIError && (cause.code === 50013 || cause.code === 10011)) ||
    (cause instanceof Error && 'status' in cause && cause.status === 403)
  );
}
async function refreshPanels(
  client: DatabaseClient,
  rest: REST,
  raw: unknown,
  clock: Clock,
  timeZone: string
): Promise<void> {
  const payload = z.object({ event_id: z.uuid() }).parse(raw);
  const panels = read(client, (tx) =>
    tx
      .select()
      .from(discordPanels)
      .where(and(eq(discordPanels.eventId, payload.event_id), isNull(discordPanels.deletedAt)))
      .all()
  );
  const failures: unknown[] = [];
  for (const panel of panels) {
    const data = read(client, (tx) => loadPanelEvent(tx, payload.event_id));
    // An old panel must not continue accepting registrations after the event is rebound.
    if (data.guildId !== panel.guildId) {
      write(client, (tx) => {
        tx.update(discordPanels)
          .set({ deletedAt: clock.now() })
          .where(eq(discordPanels.id, panel.id))
          .run();
      });
      continue;
    }
    try {
      await rest.patch(`/channels/${panel.channelId}/messages/${panel.messageId}`, {
        body: renderPanel(data.event, { ...data.counts, now: clock.now(), timeZone }, panel.locale)
      });
    } catch (cause) {
      if (cause instanceof DiscordAPIError && (cause.status === 404 || cause.code === 10008)) {
        write(client, (tx) => {
          tx.update(discordPanels)
            .set({ deletedAt: clock.now() })
            .where(eq(discordPanels.id, panel.id))
            .run();
        });
      } else if (cause instanceof RateLimitError) throw cause;
      else failures.push(cause);
    }
  }
  if (failures.length) throw failures[0];
}
