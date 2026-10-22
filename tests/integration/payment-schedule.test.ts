import { afterEach, beforeEach, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { write } from '$lib/server/db/client';
import {
  checkinRecords,
  collectionPaymentMethods,
  collections,
  events,
  outboxEvents,
  paymentRequests,
  registrations
} from '$lib/server/db/schema';
import { getEventDashboard } from '$lib/server/domain/events/dashboard';
import { configureEventPayment } from '$lib/server/domain/payments/event-payment';
import { tickOnce } from '$lib/server/domain/payments/holds';
import { confirmManualPayment, waivePaymentRequest } from '$lib/server/domain/payments/requests';
import { startCheckout } from '$lib/server/domain/payments/checkout';
import { settleCheckout } from '$lib/server/domain/payments/settle';
import { defaultTuning } from '$lib/server/config';
import { fixedClock, testDatabase } from '../database';
import { GatedCheckout, paidEvent } from '../support/paid-event';

let client: DatabaseClient;
beforeEach(() => {
  client = testDatabase();
});
afterEach(() => client.db.$client.close());

async function scheduled(pricePending = false) {
  const fixture = await paidEvent(client, 'pay_later', 20);
  const opensAt = new Date(fixedClock.now().getTime() + 60 * 60_000);
  const dueAt = new Date(opensAt.getTime() + 100 * 60 * 60_000);
  const additionalOpensAt = new Date(opensAt.getTime() + 50 * 60 * 60_000);
  write(client, (tx) => {
    const event = tx
      .update(events)
      .set({ paymentOpensAt: opensAt, paymentDueAt: dueAt, additionalOpensAt })
      .where(eq(events.id, fixture.event.id))
      .returning()
      .get()!;
    configureEventPayment(
      tx,
      event,
      {
        paymentRequirement: 'pay_later',
        amountToCollect: pricePending ? '0' : '5000',
        pricePending,
        roundingUnit: 100,
        holdMinutes: 30
      },
      fixedClock,
      defaultTuning
    );
  });
  return { ...fixture, opensAt, dueAt, additionalOpensAt };
}

it('creates no obligation before opening, then opens and notifies exactly once', async () => {
  const fixture = await scheduled();
  const first = await fixture.join();
  const second = await fixture.join('200000000000000003');
  expect(first.status).toBe('confirmed');
  expect(second.status).toBe('confirmed');
  expect(client.db.select().from(paymentRequests).all()).toEqual([]);
  expect(client.db.select().from(collections).get()?.status).toBe('draft');

  tickOnce(client, fixture.opensAt);
  tickOnce(client, fixture.opensAt);
  expect(client.db.select().from(paymentRequests).all()).toHaveLength(2);
  expect(client.db.select().from(collections).get()).toMatchObject({
    status: 'open',
    dueAt: fixture.dueAt
  });
  const opened = client.db
    .select()
    .from(outboxEvents)
    .all()
    .filter((row) => JSON.stringify(row.payloadJson).includes('payment_open'));
  expect(opened).toHaveLength(2);
});

it('keeps a pending price structural, editable before opening, and visible to organizers', async () => {
  const fixture = await scheduled(true);
  await fixture.join();
  expect(
    client.db
      .select()
      .from(collections)
      .all()
      .every((row) => row.status === 'archived')
  ).toBe(true);
  tickOnce(client, fixture.opensAt);
  expect(client.db.select().from(paymentRequests).all()).toEqual([]);
  const dashboard = getEventDashboard(client, fixture.owner.userId, fixture.event.id);
  expect(dashboard.paymentSchedule.pendingPrice).toBe(true);
  expect(dashboard.steps).toContainEqual(
    expect.objectContaining({ key: 'event.setup_payment_price', done: false })
  );

  write(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, fixture.event.id)).get()!;
    configureEventPayment(
      tx,
      event,
      { paymentRequirement: 'pay_later', amountToCollect: '6000', roundingUnit: 100 },
      fixedClock,
      defaultTuning
    );
  });
  expect(
    client.db.select().from(collections).where(eq(collections.status, 'draft')).get()
  ).toBeTruthy();
  tickOnce(client, new Date(fixture.opensAt.getTime() + 1));
  expect(client.db.select().from(paymentRequests).get()?.amountMinor).toBeGreaterThan(6000n);
});

it('reminds once and cancels only overdue unpaid registrations while preserving check-in', async () => {
  const fixture = await scheduled();
  const unpaid = await fixture.join();
  const waived = await fixture.join('200000000000000003');
  const checked = await fixture.join('200000000000000004');
  const paid = await fixture.join('200000000000000005');
  const manual = await fixture.join('200000000000000006');
  tickOnce(client, fixture.opensAt);
  const waivedRequest = client.db
    .select()
    .from(paymentRequests)
    .where(eq(paymentRequests.registrationId, waived.id))
    .get()!;
  await waivePaymentRequest(
    client,
    {
      actorUserId: fixture.owner.userId,
      paymentRequestId: waivedRequest.id,
      idempotencyKey: 'scheduled-waiver',
      reason: 'test'
    },
    fixedClock
  );
  client.db
    .update(paymentRequests)
    .set({ status: 'paid' })
    .where(eq(paymentRequests.registrationId, paid.id))
    .run();
  const manualRequest = client.db
    .select()
    .from(paymentRequests)
    .where(eq(paymentRequests.registrationId, manual.id))
    .get()!;
  const cash = client.db
    .select()
    .from(collectionPaymentMethods)
    .where(eq(collectionPaymentMethods.label, 'payments.default_method.cash.label'))
    .get()!;
  await confirmManualPayment(
    client,
    {
      actorUserId: fixture.owner.userId,
      paymentRequestId: manualRequest.id,
      paymentMethodId: cash.id,
      idempotencyKey: 'scheduled-manual',
      externalReference: '',
      note: ''
    },
    fixedClock
  );
  write(client, (tx) => {
    tx.insert(checkinRecords)
      .values({
        eventId: fixture.event.id,
        registrationId: checked.id,
        actorUserId: fixture.owner.userId,
        status: 'checked_in',
        method: 'search',
        createdAt: fixedClock.now()
      })
      .run();
  });

  const reminderAt = new Date(
    fixture.dueAt.getTime() - defaultTuning.OFFKAI_PAYMENT_REMINDER_LEAD_HOURS * 3_600_000
  );
  tickOnce(client, reminderAt);
  tickOnce(client, reminderAt);
  expect(
    client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.registrationId, unpaid.id))
      .get()?.remindedAt
  ).toEqual(reminderAt);
  expect(
    client.db
      .select()
      .from(outboxEvents)
      .all()
      .filter((row) => JSON.stringify(row.payloadJson).includes('payment_due_soon'))
  ).toHaveLength(2);

  tickOnce(client, fixture.dueAt);
  const statuses = new Map(
    client.db
      .select()
      .from(registrations)
      .all()
      .map((row) => [row.id, row.status])
  );
  expect(statuses.get(unpaid.id)).toBe('cancelled');
  expect(statuses.get(waived.id)).toBe('confirmed');
  expect(statuses.get(checked.id)).toBe('confirmed');
  expect(statuses.get(paid.id)).toBe('confirmed');
  expect(statuses.get(manual.id)).toBe('confirmed');
  expect(
    client.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.type, 'notify'), eq(outboxEvents.status, 'pending')))
      .all()
      .some((row) => JSON.stringify(row.payloadJson).includes('payment_overdue'))
  ).toBe(true);
});

it('rejects the gap before additional recruitment and admits a held seat when it opens', async () => {
  const fixture = await scheduled();
  write(client, (tx) =>
    tx
      .update(events)
      .set({ registrationClosesAt: fixedClock.now() })
      .where(eq(events.id, fixture.event.id))
      .run()
  );
  fixedClock.advance(1);
  await expect(fixture.join()).rejects.toMatchObject({ code: 'not_registrable' });
  fixedClock.advance(fixture.additionalOpensAt.getTime() - fixedClock.now().getTime());
  tickOnce(client, fixedClock.now());
  expect((await fixture.join()).status).toBe('held');
});

it('backfills existing confirmed registrations when none changes to unscheduled pay later', async () => {
  const fixture = await paidEvent(client, 'pay_later', 5);
  write(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, fixture.event.id)).get()!;
    configureEventPayment(
      tx,
      event,
      { paymentRequirement: 'none', amountToCollect: '0' },
      fixedClock
    );
  });
  const registration = await fixture.join();
  expect(client.db.select().from(paymentRequests).all()).toEqual([]);
  write(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, fixture.event.id)).get()!;
    configureEventPayment(
      tx,
      event,
      { paymentRequirement: 'pay_later', amountToCollect: '5000', roundingUnit: 100 },
      fixedClock,
      defaultTuning
    );
  });
  expect(client.db.select().from(paymentRequests).get()?.registrationId).toBe(registration.id);
});

it('preserves late money when the deadline tick lands between Checkout phases', async () => {
  const fixture = await scheduled();
  const registration = await fixture.join();
  tickOnce(client, fixture.opensAt);
  const gateway = new GatedCheckout();
  const checkout = startCheckout(
    client,
    gateway,
    {
      userId: registration.userId,
      registrationId: registration.id,
      successUrl: 'https://example.test/checkout/done',
      cancelUrl: 'https://example.test/checkout/cancelled'
    },
    fixedClock
  ).then(
    (url) => ({ url }),
    (error: unknown) => ({ error })
  );
  await gateway.entered;
  tickOnce(client, fixture.dueAt);
  gateway.resume();
  expect(await checkout).toHaveProperty('error');
  expect(
    (await settleCheckout(client, gateway.settlement('evt_after_due'), fixedClock)).conflict
  ).toBe(true);
  expect(client.db.select().from(paymentRequests).get()?.status).toBe('refund_due');
  expect(client.db.select().from(registrations).get()?.status).toBe('cancelled');
});

it('keeps joins pay-later while a pending price delays opening, then backfills them', async () => {
  const fixture = await scheduled(true);
  fixedClock.advance(fixture.opensAt.getTime() - fixedClock.now().getTime() + 1);
  tickOnce(client, fixedClock.now());
  const late = await fixture.join('200000000000000077');
  expect(late.status).toBe('confirmed');
  expect(client.db.select().from(paymentRequests).all()).toHaveLength(0);
  const event = client.db.select().from(events).get()!;
  write(client, (tx) =>
    configureEventPayment(
      tx,
      event,
      {
        paymentRequirement: 'pay_later',
        amountToCollect: '5000',
        pricePending: false,
        roundingUnit: 100,
        holdMinutes: 30
      },
      fixedClock,
      defaultTuning
    )
  );
  tickOnce(client, fixedClock.now());
  expect(
    client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.registrationId, late.id))
      .all()
  ).toHaveLength(1);
  expect((await fixture.join('200000000000000078')).status).toBe('held');
});

it('does not send the deadline reminder to held seats from the additional recruitment', async () => {
  const fixture = await scheduled();
  // Inside both the additional recruitment and the reminder lead time, with the hold still live.
  fixedClock.advance(fixture.dueAt.getTime() - fixedClock.now().getTime() - 60 * 60_000);
  tickOnce(client, fixedClock.now());
  const held = await fixture.join('200000000000000079');
  expect(held.status).toBe('held');
  tickOnce(client, fixedClock.now());
  expect(
    client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.registrationId, held.id))
      .get()?.remindedAt
  ).toBeNull();
});
