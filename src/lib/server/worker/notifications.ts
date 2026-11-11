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
  registrations,
  paymentRequests
} from '$lib/server/db/schema';
import type { Clock } from '$lib/server/clock';
import type { Tuning } from '$lib/server/config';
import { notificationRoute } from '$lib/server/domain/notifications/route';
import { notificationKinds } from '$lib/server/domain/notifications/outbox';
import { translator } from '$lib/i18n';
import { appendAudit } from '$lib/server/domain/audit';
import { findEventPanel, panelJumpUrl } from '$lib/server/domain/discord/panels';
import { overdueRule } from '$lib/server/interactions/renderers';
import { time } from '@discordjs/formatters';

type NotificationKind = (typeof notificationKinds)[number];
type NotificationRow = {
  registration: typeof registrations.$inferSelect;
  event: typeof events.$inferSelect;
};

/** Kinds that ask the participant to pay, so the message links to where the pay button is. */
const payableKinds: ReadonlySet<NotificationKind> = new Set([
  'payment_reminder',
  'payment_open',
  'payment_due_soon',
  'payment_past_due',
  'payment_past_due_manual',
  'hold_expiring'
]);

/**
 * One message body for the DM and the private-thread fallback alike, so the two routes cannot
 * drift. Text follows the registration's state at send time: a promotion that left the seat held
 * states its hold deadline, and only messages that ask for payment carry the panel link.
 */
export function renderNotification(
  kind: NotificationKind,
  row: NotificationRow,
  panelUrl: string | undefined,
  mention?: string
) {
  const t = translator(row.registration.locale);
  const { registration, event } = row;
  const held = registration.status === 'held' && registration.holdExpiresAt;
  const main =
    kind === 'waitlist_confirmed' && held
      ? t('notify.waitlist_held', { deadline: time(registration.holdExpiresAt!, 'F') })
      : t(`notify.${kind}`);
  const detail =
    (kind === 'payment_open' || kind === 'payment_due_soon') && event.paymentDueAt
      ? t('payment.schedule_deadline', { due: time(event.paymentDueAt, 'F') })
      : kind === 'payment_past_due'
        ? overdueRule(event, t)
        : kind === 'hold_expiring' && held
          ? t('payment.hold_countdown', { time: time(registration.holdExpiresAt!, 'F') })
          : '';
  const title = event.title.slice(0, 200).replace(/[@*_`~|>]/g, '');
  const content = [mention, main, detail, title].filter(Boolean).join('\n');
  const linked = panelUrl && (payableKinds.has(kind) || (kind === 'waitlist_confirmed' && held));
  return {
    flags: 32768,
    allowed_mentions: { parse: [] as string[] },
    components: [
      {
        type: 17,
        components: [
          { type: 10, content },
          ...(linked
            ? [
                {
                  type: 1,
                  components: [{ type: 2, style: 5, label: t('notify.open_panel'), url: panelUrl }]
                }
              ]
            : [])
        ]
      }
    ]
  };
}

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
    .object({
      registration_id: z.uuid(),
      kind: z.enum(notificationKinds),
      campaign_id: z.uuid().optional()
    })
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
  const deliveryKind = payload.kind;
  const campaignId = payload.campaign_id ?? '';
  if (payload.kind === 'payment_reminder') {
    if (
      !payload.campaign_id ||
      !['held', 'confirmed'].includes(row.registration.status) ||
      row.event.cancelledAt ||
      row.event.archivedAt
    )
      return;
    const unpaid = read(client, (tx) =>
      tx
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.registrationId, payload.registration_id))
        .all()
        .some((r) => ['pending', 'payment_pending'].includes(r.status))
    );
    if (!unpaid) return;
  }
  if (
    payload.kind === 'payment_open' ||
    payload.kind === 'payment_due_soon' ||
    payload.kind === 'payment_past_due' ||
    payload.kind === 'payment_past_due_manual'
  ) {
    if (!['held', 'confirmed'].includes(row.registration.status)) return;
    const unpaid = read(client, (tx) =>
      tx
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.registrationId, payload.registration_id))
        .all()
        .some((request) => ['pending', 'payment_pending'].includes(request.status))
    );
    if (!unpaid) return;
  }
  // A promotion notice is stale once the seat is gone (withdrawn, or the hold lapsed before the
  // notice could be delivered); its text follows the current state, so it must not say "confirmed".
  if (
    payload.kind === 'waitlist_confirmed' &&
    !(
      row.registration.status === 'confirmed' ||
      (row.registration.status === 'held' &&
        row.registration.holdExpiresAt &&
        row.registration.holdExpiresAt > clock.now())
    )
  )
    return;
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
          kind: deliveryKind,
          campaignId,
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
          after: { kind: deliveryKind, channel, result }
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
          eq(notificationDeliveries.kind, deliveryKind),
          eq(notificationDeliveries.campaignId, campaignId),
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
  const panel = read(client, (tx) =>
    findEventPanel(tx, row.event.id, row.integration?.guildId, row.registration.locale)
  );
  const panelUrl = panel ? panelJumpUrl(panel) : undefined;
  const message = renderNotification(payload.kind, row, panelUrl);
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
          ...renderNotification(payload.kind, row, panelUrl, `<@${row.user}>`),
          allowed_mentions: { parse: [], users: [row.user] }
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
