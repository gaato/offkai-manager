import { DiscordAPIError, RateLimitError, type REST } from '@discordjs/rest';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { read, write, type DatabaseClient } from '$lib/server/db/client';
import {
  events,
  eventDiscordIntegrations,
  externalAccounts,
  notificationDeliveries,
  notificationThreads,
  registrations
} from '$lib/server/db/schema';
import type { Clock } from '$lib/server/clock';
import type { Tuning } from '$lib/server/config';
import { notificationRoute } from '$lib/server/domain/notifications/route';
import { notificationKinds } from '$lib/server/domain/notifications/outbox';
import { translator } from '$lib/i18n';
import { appendAudit } from '$lib/server/domain/audit';

export class NotificationRetry extends Error {
  constructor(public retryAfter: number) {
    super('notification delivery deferred');
  }
}
const idSchema = z.object({ id: z.string().min(1) });
export async function deliverNotification(
  client: DatabaseClient,
  rest: REST,
  raw: unknown,
  clock: Clock,
  tuning: Tuning
) {
  const payload = z
    .object({ registration_id: z.uuid(), kind: z.enum(notificationKinds) })
    .parse(raw);
  const row = read(client, (tx) =>
    tx
      .select({
        registration: registrations,
        user: externalAccounts.providerUserId,
        integration: eventDiscordIntegrations,
        event: events
      })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .leftJoin(eventDiscordIntegrations, eq(eventDiscordIntegrations.eventId, events.id))
      .leftJoin(
        externalAccounts,
        and(
          eq(externalAccounts.userId, registrations.userId),
          eq(externalAccounts.provider, 'discord')
        )
      )
      .where(eq(registrations.id, payload.registration_id))
      .get()
  );
  if (!row) return;
  // Old warning jobs are obsolete after payment, cancellation, or deadline passage.
  if (
    payload.kind === 'hold_expiring' &&
    (row.registration.status !== 'held' ||
      !row.registration.holdExpiresAt ||
      row.registration.holdExpiresAt <= clock.now())
  )
    return;
  const record = (channel: string, messageId: string, result: string) =>
    write(client, (tx) => {
      tx.insert(notificationDeliveries)
        .values({
          registrationId: payload.registration_id,
          kind: payload.kind,
          channel,
          messageId,
          result,
          at: clock.now()
        })
        .run();
      appendAudit(
        tx,
        {
          actorUserId: null,
          eventId: row.event.id,
          action: 'notification.attempt',
          targetType: 'registration',
          targetId: payload.registration_id,
          after: { kind: payload.kind, channel, result }
        },
        clock
      );
    });
  if (!row.user) {
    record('dm', '', 'failed:10007');
    return;
  }
  const alreadySent = read(client, (tx) =>
    tx
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.registrationId, payload.registration_id),
          eq(notificationDeliveries.kind, payload.kind),
          eq(notificationDeliveries.result, 'sent')
        )
      )
      .get()
  );
  if (alreadySent) return;
  const latest = read(client, (tx) =>
    tx
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.channel, 'dm'))
      .orderBy(desc(notificationDeliveries.at))
      .get()
  );
  const delay = latest
    ? latest.at.getTime() + tuning.OFFKAI_NOTIFICATION_DM_INTERVAL_MS - clock.now().getTime()
    : 0;
  if (delay > 0) throw new NotificationRetry(delay);
  const t = translator(row.registration.locale);
  const content = `${t(`notify.${payload.kind}`)}\n${row.event.title.slice(0, 200).replace(/[@*_`~|>]/g, '')}`;
  const message = {
    flags: 32768,
    allowed_mentions: { parse: [] as string[] },
    components: [{ type: 17, components: [{ type: 10, content }] }]
  };
  try {
    const dm = idSchema.parse(
      await rest.post('/users/@me/channels', { body: { recipient_id: row.user } })
    );
    const sent = idSchema.parse(await rest.post(`/channels/${dm.id}/messages`, { body: message }));
    record('dm', sent.id, 'sent');
    return;
  } catch (cause) {
    const code =
      cause instanceof DiscordAPIError
        ? cause.code
        : cause instanceof RateLimitError
          ? 429
          : 'transport';
    record('dm', '', `failed:${code}`);
    if (cause instanceof RateLimitError) throw cause;
    if (!(cause instanceof DiscordAPIError)) throw cause;
    const next = notificationRoute(cause.status, cause.code);
    if (next === 'retry') throw cause;
    if (next === 'stop') return;
  }
  if (!row.integration?.notificationChannelId) {
    record('thread', '', 'failed:no_channel');
    return;
  }
  try {
    let thread = read(client, (tx) =>
      tx
        .select()
        .from(notificationThreads)
        .where(eq(notificationThreads.registrationId, payload.registration_id))
        .get()
    );
    if (!thread?.threadId) {
      const created = idSchema.parse(
        await rest.post(`/channels/${row.integration.notificationChannelId}/threads`, {
          body: {
            name: `${t('brand.name')}-${row.registration.id}`,
            type: 12,
            invitable: false,
            auto_archive_duration: 10080
          }
        })
      );
      write(client, (tx) => {
        tx.insert(notificationThreads)
          .values({ registrationId: payload.registration_id, threadId: created.id })
          .onConflictDoUpdate({
            target: notificationThreads.registrationId,
            set: { threadId: created.id }
          })
          .run();
        appendAudit(
          tx,
          {
            actorUserId: null,
            eventId: row.event.id,
            action: 'notification.thread_created',
            targetType: 'registration',
            targetId: payload.registration_id
          },
          clock
        );
      });
      thread = { registrationId: payload.registration_id, threadId: created.id, archivedAt: null };
    }
    await rest.put(`/channels/${thread.threadId}/thread-members/${row.user}`);
    const sent = idSchema.parse(
      await rest.post(`/channels/${thread.threadId}/messages`, {
        body: {
          ...message,
          allowed_mentions: { parse: [], users: [row.user] },
          components: [
            { type: 17, components: [{ type: 10, content: `<@${row.user}>\n${content}` }] }
          ]
        }
      })
    );
    record('thread', sent.id, 'sent');
  } catch (cause) {
    const code =
      cause instanceof DiscordAPIError
        ? cause.code
        : cause instanceof RateLimitError
          ? 429
          : 'transport';
    record('thread', '', `failed:${code}`);
    if (
      cause instanceof RateLimitError ||
      !(cause instanceof DiscordAPIError) ||
      notificationRoute(cause.status, cause.code) === 'retry'
    )
      throw cause;
  }
}
export async function archiveNotificationThreads(
  client: DatabaseClient,
  rest: REST,
  clock: Clock,
  tuning: Tuning
) {
  const rows = read(client, (tx) =>
    tx
      .select({ thread: notificationThreads, eventId: events.id })
      .from(notificationThreads)
      .innerJoin(registrations, eq(registrations.id, notificationThreads.registrationId))
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(
        and(
          isNull(notificationThreads.archivedAt),
          lte(
            events.endsAt,
            new Date(clock.now().getTime() - tuning.OFFKAI_NOTIFICATION_ARCHIVE_DAYS * 86400000)
          )
        )
      )
      .all()
  );
  for (const { thread, eventId } of rows) {
    await rest.patch(`/channels/${thread.threadId}`, { body: { archived: true } });
    write(client, (tx) => {
      tx.update(notificationThreads)
        .set({ archivedAt: clock.now() })
        .where(eq(notificationThreads.registrationId, thread.registrationId))
        .run();
      appendAudit(
        tx,
        {
          actorUserId: null,
          eventId,
          action: 'notification.thread_archived',
          targetType: 'registration',
          targetId: thread.registrationId
        },
        clock
      );
    });
  }
}
