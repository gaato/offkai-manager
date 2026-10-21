import { translate } from '$lib/i18n';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { RateLimitError } from '@discordjs/rest';
import { type DatabaseClient, write } from '$lib/server/db/client';
import {
  events,
  registrations,
  eventDiscordIntegrations,
  notificationDeliveries,
  notificationThreads,
  outboxEvents
} from '$lib/server/db/schema';
import { enqueueNotification } from '$lib/server/domain/notifications/outbox';
import { deliverNotification, archiveNotificationThreads } from '$lib/server/worker/notifications';
import { processRoleSyncBatch, claimRoleSyncEvents } from '$lib/server/worker/role-sync';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import { defaultTuning } from '$lib/server/config';
import { paidEvent } from '../support/paid-event';
import { recordingRest, responseLike } from '../support/discord-rest';
import { testDatabase, fixedClock } from '../database';
let client: DatabaseClient;
beforeEach(() => {
  client = testDatabase();
});
afterEach(() => {
  client.db.$client.close();
});
it.each([50007, 50278, 10007])(
  'records DM %s and stops when there is no permitted route',
  async (code) => {
    const fixture = await paidEvent(client);
    const registration = await fixture.join();
    const { rest, calls } = recordingRest(() =>
      responseLike({ code, message: 'Unreachable' }, code === 10007 ? 404 : 403)
    );
    await deliverNotification(
      client,
      rest,
      { registration_id: registration.id, kind: 'payment_confirmed' },
      fixedClock,
      defaultTuning
    );
    expect(calls).toHaveLength(1);
    const rows = client.db.select().from(notificationDeliveries).all();
    expect(rows[0].result).toBe(`failed:${code}`);
    expect(rows).toHaveLength(code === 10007 ? 1 : 2);
  }
);
it('spaces DMs by rescheduling, then delivers at the exact clock boundary', async () => {
  const fixture = await paidEvent(client, 'pay_later', 2);
  const a = await fixture.join();
  const b = await fixture.join('200000000000000003');
  write(client, (tx) => {
    enqueueNotification(tx, a.id, 'payment_confirmed', fixedClock);
    enqueueNotification(tx, b.id, 'payment_confirmed', fixedClock);
  });
  const { rest } = recordingRest();
  const gateway = createDiscordGateway('fake', { rest });
  await processRoleSyncBatch(client, gateway, undefined, fixedClock, defaultTuning, rest);
  expect(client.db.select().from(notificationDeliveries).all()).toHaveLength(1);
  const pending = client.db
    .select()
    .from(outboxEvents)
    .all()
    .find((job) => job.type === 'notify' && job.status === 'pending')!;
  expect(pending.nextAttemptAt).toEqual(
    new Date(fixedClock.now().getTime() + defaultTuning.OFFKAI_NOTIFICATION_DM_INTERVAL_MS)
  );
  fixedClock.advance(defaultTuning.OFFKAI_NOTIFICATION_DM_INTERVAL_MS);
  await processRoleSyncBatch(client, gateway, undefined, fixedClock, defaultTuning, rest);
  expect(client.db.select().from(notificationDeliveries).all()).toHaveLength(2);
});
it('reschedules RateLimitError.retryAfter without consuming the retry budget', async () => {
  const fixture = await paidEvent(client);
  const registration = await fixture.join();
  write(client, (tx) => enqueueNotification(tx, registration.id, 'payment_confirmed', fixedClock));
  const { rest } = recordingRest();
  const original = rest.post.bind(rest);
  rest.post = async (...args) => {
    if (String(args[0]).includes('/users/@me/channels'))
      throw new RateLimitError({
        timeToReset: 1500,
        limit: 1,
        method: 'POST',
        hash: 'test',
        url: 'https://discord.com/api/v10/users/@me/channels',
        route: '/users/@me/channels',
        majorParameter: 'global',
        global: true,
        retryAfter: 1500,
        sublimitTimeout: 0,
        scope: 'global'
      });
    return original(...args);
  };
  await processRoleSyncBatch(
    client,
    createDiscordGateway('fake', { rest }),
    undefined,
    fixedClock,
    { ...defaultTuning, OFFKAI_OUTBOX_MAX_ATTEMPTS: 1 },
    rest
  );
  const job = client.db
    .select()
    .from(outboxEvents)
    .all()
    .find((job) => job.type === 'notify')!;
  expect(job.status).toBe('pending');
  expect(job.nextAttemptAt).toEqual(new Date(fixedClock.now().getTime() + 1500));
  expect(client.db.select().from(notificationDeliveries).get()?.result).toBe('failed:429');
});
it('archives a saved private thread after the configured number of days', async () => {
  const fixture = await paidEvent(client);
  const registration = await fixture.join();
  client.db
    .insert(notificationThreads)
    .values({ registrationId: registration.id, threadId: 'thread' })
    .run();
  client.db
    .update(events)
    .set({ endsAt: new Date(fixture.event.startsAt.getTime() + 1) })
    .where(eq(events.id, fixture.event.id))
    .run();
  fixedClock.advance(
    fixture.event.startsAt.getTime() +
      1 +
      defaultTuning.OFFKAI_NOTIFICATION_ARCHIVE_DAYS * 86400000 -
      fixedClock.now().getTime()
  );
  const { rest, calls } = recordingRest();
  fixedClock.advance(-1);
  await archiveNotificationThreads(client, rest, fixedClock, defaultTuning);
  expect(calls).toHaveLength(0);
  fixedClock.advance(1);
  await archiveNotificationThreads(client, rest, fixedClock, defaultTuning);
  expect(calls[0]).toMatchObject({ method: 'PATCH', body: { archived: true } });
  expect(client.db.select().from(notificationThreads).get()?.archivedAt).toEqual(fixedClock.now());
  await archiveNotificationThreads(client, rest, fixedClock, defaultTuning);
  expect(calls).toHaveLength(1);
});

it('serializes notification claimers so DM spacing and private-thread creation cannot race', async () => {
  const fixture = await paidEvent(client, 'pay_later', 2);
  const a = await fixture.join();
  const b = await fixture.join('200000000000000003');
  client.db.delete(outboxEvents).run();
  write(client, (tx) => {
    enqueueNotification(tx, a.id, 'payment_confirmed', fixedClock);
    enqueueNotification(tx, b.id, 'payment_confirmed', fixedClock);
  });
  expect(claimRoleSyncEvents(client, 1, fixedClock)).toHaveLength(1);
  expect(claimRoleSyncEvents(client, 1, fixedClock)).toEqual([]);
});

it.each([
  { locale: 'ja', fallback: false },
  { locale: 'en', fallback: false },
  { locale: 'ja', fallback: true },
  { locale: 'en', fallback: true }
] as const)(
  'delivers each notification in the stored $locale locale only (thread fallback: $fallback)',
  async ({ locale, fallback }) => {
    const fixture = await paidEvent(client);
    const registration = await fixture.join(undefined, locale);
    client.db
      .update(eventDiscordIntegrations)
      .set({ notificationChannelId: 'notifications' })
      .where(eq(eventDiscordIntegrations.eventId, fixture.event.id))
      .run();
    const { rest, calls } = recordingRest((call) =>
      fallback && call.url.endsWith('/users/@me/channels')
        ? responseLike({ code: 50007, message: 'No DMs' }, 403)
        : responseLike({ id: 'thread-message' })
    );
    for (const kind of [
      'payment_confirmed',
      'hold_expiring',
      'hold_expired',
      'waitlist_confirmed'
    ] as const) {
      // Keep the expiry warning current; the others are immutable outbox facts.
      if (kind === 'hold_expiring')
        client.db
          .update(registrations)
          .set({ status: 'held', holdExpiresAt: new Date(fixedClock.now().getTime() + 60000) })
          .where(eq(registrations.id, registration.id))
          .run();
      await deliverNotification(
        client,
        rest,
        { registration_id: registration.id, kind },
        fixedClock,
        { ...defaultTuning, OFFKAI_NOTIFICATION_DM_INTERVAL_MS: 0 }
      );
      const body = JSON.stringify(
        calls.filter((call) => call.url.endsWith('/messages')).at(-1)!.body
      );
      expect(body).toContain(translate(locale, `notify.${kind}`));
      expect(body).not.toContain(translate(locale === 'ja' ? 'en' : 'ja', `notify.${kind}`));
    }
  }
);
