import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { testDatabase, fixedClock } from '../database';
import { paidEvent } from '../support/paid-event';
import { guildId } from '../support/discord-registration';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { changeDoorCheckin, getDoorCard } from '$lib/server/domain/checkin/door';
import { getRoster } from '$lib/server/domain/checkin/roster';
import {
  receptionStatus,
  previewReminder,
  confirmReminder
} from '$lib/server/domain/notifications/reception';
import { saveDisclosure } from '$lib/server/domain/orgs/disclosure';
import { publishEvent } from '$lib/server/domain/events';
import {
  events,
  eventDiscordIntegrations,
  paymentRecords,
  paymentRequests,
  checkinRecords,
  auditLogs,
  outboxEvents,
  organizationMemberships,
  collectionPaymentMethods,
  notificationDeliveries
} from '$lib/server/db/schema';
import { listParticipants } from '$lib/server/domain/registrations';
import { deliverNotification } from '$lib/server/worker/notifications';
import { defaultTuning } from '$lib/server/config';
import { recordingRest } from '../support/discord-rest';
let client: ReturnType<typeof testDatabase>;
beforeEach(() => {
  client = testDatabase();
});
afterEach(() => client.db.$client.close());
async function fixture(requirement: 'none' | 'pay_later' | 'pay_to_confirm' = 'pay_to_confirm') {
  const f = await paidEvent(client, requirement, 180);
  const staff = await upsertDiscordIdentity(
    client,
    {
      providerUserId: '200000000000000099',
      username: 'door',
      displayName: 'Door Staff',
      avatarUrl: ''
    },
    fixedClock
  );
  client.db
    .update(eventDiscordIntegrations)
    .set({ staffRoleId: '600000000000000001' })
    .where(eq(eventDiscordIntegrations.eventId, f.event.id))
    .run();
  return {
    ...f,
    staff: { actorUserId: staff.userId, guildId, roles: ['600000000000000001'] },
    organizer: { actorUserId: f.owner.userId, guildId, roles: [] }
  };
}
describe('door transactions', () => {
  it.each(['cash', 'paypay'] as const)(
    'settles %s and checks in atomically, idempotently, with undo preserving payment',
    async (method) => {
      const f = await fixture();
      const r = await f.join();
      expect(() => changeDoorCheckin(client, r.id, f.staff, 'check', fixedClock)).toThrow();
      const first = changeDoorCheckin(client, r.id, f.staff, method, fixedClock);
      expect(first.registration.status).toBe('confirmed');
      expect(first.requests[0].status).toBe('paid');
      expect(first.checkin?.by).toBe('Door Staff');
      for (const action of [method, 'cash', 'paypay', 'check'] as const)
        changeDoorCheckin(client, r.id, f.staff, action, fixedClock);
      expect(client.db.select().from(paymentRecords).all()).toHaveLength(1);
      expect(client.db.select().from(checkinRecords).all()).toHaveLength(1);
      expect(
        client.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'payment.confirm_manual'))
          .all()
      ).toHaveLength(1);
      changeDoorCheckin(client, r.id, f.staff, 'undo', fixedClock);
      changeDoorCheckin(client, r.id, f.staff, 'undo', fixedClock);
      expect(getDoorCard(client, r.id, f.staff).checkin).toBeUndefined();
      expect(getDoorCard(client, r.id, f.staff).requests[0].status).toBe('paid');
    }
  );
  it('allows free and confirmed unpaid check-in; orders roster by number rather than name', async () => {
    const f = await fixture('pay_later');
    const a = await f.join();
    const b = await f.join('200000000000000003');
    client.db
      .update(registrations)
      .set({ displayNameSnapshot: 'Z last' })
      .where(eq(registrations.id, a.id))
      .run();
    changeDoorCheckin(client, a.id, f.staff, 'check', fixedClock);
    const card = changeDoorCheckin(client, a.id, f.staff, 'cash', fixedClock);
    expect(card.requests[0].status).toBe('paid');
    const roster = getRoster(client, f.owner.userId, f.event.id);
    expect(roster.map((r) => r.number)).toEqual([a.number, b.number]);
    expect(roster[0].methods).toEqual(['payments.default_method.cash.label']);
    expect(roster[0].checkedIn).toBe(true);
  });
  it('rechecks guild, role and organizer access every time, without granting organization membership', async () => {
    const f = await fixture('none');
    const r = await f.join();
    changeDoorCheckin(client, r.id, f.staff, 'check', fixedClock);
    expect(
      client.db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, f.staff.actorUserId))
        .all()
    ).toEqual([]);
    expect(() => getDoorCard(client, r.id, { ...f.staff, roles: [] })).toThrow();
    expect(() =>
      changeDoorCheckin(
        client,
        r.id,
        { ...f.organizer, guildId: '400000000000000009' },
        'undo',
        fixedClock
      )
    ).toThrow();
    client.db
      .update(eventDiscordIntegrations)
      .set({ staffRoleId: '' })
      .where(eq(eventDiscordIntegrations.eventId, f.event.id))
      .run();
    expect(() => changeDoorCheckin(client, r.id, f.staff, 'undo', fixedClock)).toThrow();
    changeDoorCheckin(client, r.id, f.organizer, 'undo', fixedClock);
  });
});
import { registrations } from '$lib/server/db/schema';
describe('organizer operations', () => {
  it('previews a bounded audience, enqueues only still-unpaid once and delivers localized reminders', async () => {
    const f = await fixture('pay_later');
    const a = await f.join(undefined, 'ja');
    const b = await f.join('200000000000000003');
    const preview = previewReminder(client, f.event.id, f.organizer, fixedClock);
    expect(preview).toMatchObject({ held: 0, confirmed: 2, ja: 1, en: 1 });
    expect(() => confirmReminder(client, preview.id, f.staff, fixedClock)).toThrow();
    changeDoorCheckin(client, b.id, f.staff, 'cash', fixedClock);
    await f.join('200000000000000004');
    expect(confirmReminder(client, preview.id, f.organizer, fixedClock)).toBe(1);
    expect(confirmReminder(client, preview.id, f.organizer, fixedClock)).toBe(0);
    const jobs = client.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'notify'),
          eq(outboxEvents.dedupeKey, `notify:${a.id}:reminder:${preview.id}`)
        )
      )
      .all();
    expect(jobs).toHaveLength(1);
    const { rest, calls } = recordingRest();
    await deliverNotification(client, rest, jobs[0].payloadJson, fixedClock, defaultTuning);
    expect(JSON.stringify(calls)).toContain('参加費のお支払い');
    const next = previewReminder(client, f.event.id, f.organizer, fixedClock);
    fixedClock.advance(15 * 60_000);
    expect(() => confirmReminder(client, next.id, f.organizer, fixedClock)).toThrow();
    const status = receptionStatus(client, f.event.id, f.organizer);
    expect(status).toMatchObject({ confirmed: 3, unpaid: 2, checkedIn: 1 });
  });
  it('blocks paid publication until valid disclosure and leaves free publication available', async () => {
    const f = await fixture();
    client.db.update(events).set({ visibility: 'draft' }).where(eq(events.id, f.event.id)).run();
    await expect(
      publishEvent(client, { actorUserId: f.owner.userId, eventId: f.event.id }, fixedClock)
    ).rejects.toMatchObject({ code: 'disclosure_required' });
    saveDisclosure(
      client,
      f.org.id,
      f.owner.userId,
      {
        sellerName: 'Seller',
        email: 'seller@example.test',
        address: '',
        phone: '',
        discloseOnRequest: true,
        additionalFees: 'included',
        refundPolicy: 'Contact us.'
      },
      fixedClock
    );
    await expect(
      publishEvent(client, { actorUserId: f.owner.userId, eventId: f.event.id }, fixedClock)
    ).resolves.toMatchObject({ visibility: 'public' });
    expect(client.db.select().from(paymentRequests).all()).toEqual([]);
  });
});

it('rejects disabled methods and expired holds without recording money or attendance', async () => {
  const f = await fixture();
  const r = await f.join();
  client.db
    .update(collectionPaymentMethods)
    .set({ enabled: false })
    .where(eq(collectionPaymentMethods.label, 'payments.default_method.cash.label'))
    .run();
  expect(() => changeDoorCheckin(client, r.id, f.staff, 'cash', fixedClock)).toThrow();
  fixedClock.advance(30 * 60_000);
  expect(() => changeDoorCheckin(client, r.id, f.staff, 'paypay', fixedClock)).toThrow();
  expect(client.db.select().from(paymentRecords).all()).toEqual([]);
  expect(client.db.select().from(checkinRecords).all()).toEqual([]);
  expect(client.db.select().from(paymentRequests).get()?.status).toBe('pending');
});
it('new reminder campaigns can deliver again and a successful reminder clears earlier reachability failures', async () => {
  const f = await fixture('pay_later');
  const r = await f.join();
  const first = previewReminder(client, f.event.id, f.organizer, fixedClock);
  confirmReminder(client, first.id, f.organizer, fixedClock);
  client.db
    .insert(notificationDeliveries)
    .values({
      registrationId: r.id,
      kind: 'payment_reminder',
      campaignId: first.id,
      channel: 'dm',
      messageId: '',
      result: 'failed:50007',
      at: fixedClock.now()
    })
    .run();
  const participants = () =>
    listParticipants(client, {
      actorUserId: f.owner.userId,
      eventId: f.event.id,
      status: 'all',
      query: ''
    });
  expect((await participants()).rows[0].unreachable).toBe(true);
  const { rest, calls } = recordingRest();
  for (let n = 0; n < 2; n++) {
    const preview = previewReminder(client, f.event.id, f.organizer, fixedClock);
    expect(confirmReminder(client, preview.id, f.organizer, fixedClock)).toBe(1);
    fixedClock.advance(1000);
    const payload = { registration_id: r.id, kind: 'payment_reminder', campaign_id: preview.id };
    await deliverNotification(client, rest, payload, fixedClock, defaultTuning);
    await deliverNotification(client, rest, payload, fixedClock, defaultTuning);
  }
  expect(calls.filter((c) => c.url.includes('/messages'))).toHaveLength(2);
  expect((await participants()).rows[0].unreachable).toBe(false);
  expect(client.db.select().from(notificationDeliveries).all()).toHaveLength(3);
});
