import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { type DatabaseClient, write } from '$lib/server/db/client';
import {
  events,
  registrations,
  paymentRequests,
  paymentRecords,
  outboxEvents,
  collectionPaymentMethods
} from '$lib/server/db/schema';
import {
  startCheckout,
  settleCheckout,
  confirmManualPayment,
  waivePaymentRequest
} from '$lib/server/domain/payments';
import { tickOnce } from '$lib/server/domain/payments/holds';
import { configureEventPayment } from '$lib/server/domain/payments/event-payment';
import { withdrawRegistration } from '$lib/server/domain/registrations/participant';
import { defaultTuning } from '$lib/server/config';
import { createEvent } from '$lib/server/domain/events';
import { fixedClock, testDatabase } from '../database';
import { paidEvent, GatedCheckout } from '../support/paid-event';
let client: DatabaseClient;
beforeEach(() => {
  client = testDatabase();
});
afterEach(() => {
  client.db.$client.close();
});
const input = (registration: { id: string; userId: string }) => ({
  userId: registration.userId,
  registrationId: registration.id,
  successUrl: 'https://example.test/checkout/done',
  cancelUrl: 'https://example.test/checkout/cancelled'
});
it('counts held seats, snapshots fees, releases exactly once and promotes the oldest waiter', async () => {
  const fixture = await paidEvent(client);
  const first = await fixture.join();
  const second = await fixture.join('200000000000000003');
  expect(first.status).toBe('held');
  expect(second.status).toBe('waitlisted');
  const request = client.db.select().from(paymentRequests).get()!;
  expect(request.applicationFeeAmount).toBe((request.amountMinor * 200n) / 10000n);
  expect(tickOnce(client, first.holdExpiresAt!)).toBe(1);
  expect(tickOnce(client, first.holdExpiresAt!)).toBe(0);
  expect(
    client.db.select().from(registrations).where(eq(registrations.id, first.id)).get()?.status
  ).toBe('cancelled');
  expect(
    client.db.select().from(registrations).where(eq(registrations.id, second.id)).get()?.status
  ).toBe('held');
  const jobs = client.db.select().from(outboxEvents).all();
  expect(jobs.some((j) => j.type === 'panel.refresh')).toBe(true);
  expect(jobs.filter((j) => j.type === 'notify').map((j) => j.payloadJson)).toContainEqual({
    registration_id: first.id,
    kind: 'hold_expired'
  });
});
it('settles a webhook gated between intent and attachment, without reverting paid state', async () => {
  const fixture = await paidEvent(client);
  const registration = await fixture.join();
  const gateway = new GatedCheckout();
  const checkout = startCheckout(client, gateway, input(registration), fixedClock);
  await gateway.entered;
  expect(client.db.$client.inTransaction).toBe(false);
  expect(gateway.input.applicationFeeAmount).toBe(106n);
  const result = await settleCheckout(client, gateway.settlement(), fixedClock);
  expect(result.conflict).toBe(false);
  gateway.resume();
  expect(await checkout).toBe(input(registration).successUrl);
  expect(client.db.select().from(registrations).get()?.status).toBe('confirmed');
  expect(client.db.select().from(paymentRecords).get()?.applicationFeeAmount).toBe(106n);
  expect((await settleCheckout(client, gateway.settlement(), fixedClock)).alreadyProcessed).toBe(
    true
  );
  expect(
    (await settleCheckout(client, gateway.settlement('evt_other_same_session'), fixedClock))
      .alreadyProcessed
  ).toBe(true);
  expect(client.db.select().from(paymentRecords).all()).toHaveLength(1);
});
it.each(['expire', 'cancel'] as const)(
  'preserves late money when %s occurs between phases',
  async (interleaving) => {
    const fixture = await paidEvent(client);
    const registration = await fixture.join();
    const gateway = new GatedCheckout();
    const result = startCheckout(client, gateway, input(registration), fixedClock).then(
      (url) => ({ url }),
      (error: unknown) => ({ error })
    );
    await gateway.entered;
    if (interleaving === 'expire') {
      const hold = client.db.select().from(registrations).get()!.holdExpiresAt!;
      fixedClock.advance(hold.getTime() - fixedClock.now().getTime());
      tickOnce(client, fixedClock.now());
    } else
      await withdrawRegistration(
        client,
        { registrationId: registration.id, userId: registration.userId },
        fixedClock
      );
    gateway.resume();
    expect(await result).toHaveProperty('error');
    expect((await settleCheckout(client, gateway.settlement(), fixedClock)).conflict).toBe(true);
    expect(client.db.select().from(paymentRequests).get()?.status).toBe('refund_due');
    expect(client.db.select().from(registrations).get()?.status).toBe('cancelled');
    expect(client.db.select().from(paymentRecords).all()).toHaveLength(1);
  }
);
it('reuses an open Checkout, aligns the seat deadline, and starts a fresh attempt after release', async () => {
  const fixture = await paidEvent(client);
  const registration = await fixture.join();
  const gateway = new GatedCheckout();
  gateway.resume();
  const url = await startCheckout(client, gateway, input(registration), fixedClock);
  expect(await startCheckout(client, gateway, input(registration), fixedClock)).toBe(url);
  expect(gateway.calls).toBe(1);
  expect(gateway.input.expiresAt).toEqual(
    client.db.select().from(registrations).get()?.holdExpiresAt
  );
  expect(gateway.input.expiresAt!.getTime() - fixedClock.now().getTime()).toBeGreaterThanOrEqual(
    30 * 60000
  );
  tickOnce(client, gateway.input.expiresAt!);
  const rejoined = await fixture.join();
  expect(rejoined.id).not.toBe(registration.id);
  expect(rejoined.status).toBe('held');
  expect(rejoined.number).toBeGreaterThan(registration.number);
});
it.each(['manual', 'waive'] as const)(
  'settles a pay-later request by %s while attendance stays confirmed',
  async (method) => {
    const fixture = await paidEvent(client, 'pay_later');
    const registration = await fixture.join();
    expect(registration.status).toBe('confirmed');
    const request = client.db.select().from(paymentRequests).get()!;
    if (method === 'manual') {
      const cash = client.db
        .select()
        .from(collectionPaymentMethods)
        .where(eq(collectionPaymentMethods.label, 'payments.default_method.cash.label'))
        .get()!;
      await confirmManualPayment(
        client,
        {
          actorUserId: fixture.owner.userId,
          paymentRequestId: request.id,
          paymentMethodId: cash.id,
          idempotencyKey: 'manual',
          externalReference: '',
          note: ''
        },
        fixedClock
      );
    } else
      await waivePaymentRequest(
        client,
        {
          actorUserId: fixture.owner.userId,
          paymentRequestId: request.id,
          idempotencyKey: 'waive',
          reason: 'Organizer waiver'
        },
        fixedClock
      );
    expect(client.db.select().from(paymentRequests).get()?.status).toBe(
      method === 'manual' ? 'paid' : 'waived'
    );
    expect(client.db.select().from(registrations).get()?.status).toBe('confirmed');
    expect(client.db.select().from(paymentRecords).all()).toHaveLength(1);
  }
);
it('snapshots the configured platform fee at creation, independent of later config changes', async () => {
  const base = await paidEvent(client);
  const created = await createEvent(
    client,
    {
      actorUserId: base.owner.userId,
      organizationId: base.org.id,
      title: 'Snapshot',
      startsAt: '2027-01-01T12:00',
      timeZone: 'Asia/Tokyo',
      paymentRequirement: 'pay_later',
      amountToCollect: '1000'
    },
    undefined,
    fixedClock,
    { ...defaultTuning, OFFKAI_PLATFORM_FEE_BPS: 300 }
  );
  expect(created.platformFeeBps).toBe(300);
  expect(
    client.db.select().from(events).where(eq(events.id, created.id)).get()?.platformFeeBps
  ).toBe(300);
  await base.join();
  expect(client.db.select().from(paymentRequests).get()?.applicationFeeAmount).toBe(106n);
});
it('reports frozen payment settings with their own error code once an obligation exists', async () => {
  const fixture = await paidEvent(client, 'pay_later', 5);
  await fixture.join();
  const event = client.db.select().from(events).get()!;
  expect(() =>
    write(client, (tx) =>
      configureEventPayment(tx, event, { paymentRequirement: 'pay_to_confirm' }, fixedClock)
    )
  ).toThrow(expect.objectContaining({ code: 'payment_frozen' }));
  // Manual methods stay editable after obligations exist.
  write(client, (tx) =>
    configureEventPayment(
      tx,
      event,
      {
        paymentRequirement: 'pay_later',
        amountToCollect: event.amountToCollectMinor.toString(),
        manualCash: true
      },
      fixedClock
    )
  );
});
