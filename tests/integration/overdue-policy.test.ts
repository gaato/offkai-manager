import { afterEach, beforeEach, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { write } from '$lib/server/db/client';
import {
  auditLogs,
  checkinRecords,
  events,
  outboxEvents,
  paymentRequests,
  registrations
} from '$lib/server/db/schema';
import { getEventDashboard } from '$lib/server/domain/events/dashboard';
import { createEvent, updateSettings } from '$lib/server/domain/events';
import { configureEventPayment } from '$lib/server/domain/payments/event-payment';
import { tickOnce } from '$lib/server/domain/payments/holds';
import {
  checkoutSettlementSlackMs,
  listReleasableOverdue,
  releaseOverdueRegistrations
} from '$lib/server/domain/payments/overdue';
import { defaultTuning } from '$lib/server/config';
import { formatWallClockInput } from '$lib/server/time';
import { overduePolicyColumns, type OverduePolicy } from '$lib/shared/overdue-policy';
import { fixedClock, testDatabase } from '../database';
import { paidEvent } from '../support/paid-event';

const day = 24 * 60 * 60_000;
let client: DatabaseClient;
beforeEach(() => {
  client = testDatabase();
});
afterEach(() => client.db.$client.close());

async function scheduled(capacity: number, policy: OverduePolicy, windowHours = 100) {
  const fixture = await paidEvent(client, 'pay_later', capacity);
  const opensAt = new Date(fixedClock.now().getTime() + 60 * 60_000);
  const dueAt = new Date(opensAt.getTime() + windowHours * 60 * 60_000);
  write(client, (tx) => {
    const event = tx
      .update(events)
      .set({ paymentOpensAt: opensAt, paymentDueAt: dueAt, ...overduePolicyColumns(policy) })
      .where(eq(events.id, fixture.event.id))
      .returning()
      .get()!;
    configureEventPayment(
      tx,
      event,
      { paymentRequirement: 'pay_later', amountToCollect: '5000', roundingUnit: 100 },
      fixedClock,
      defaultTuning
    );
  });
  return { ...fixture, opensAt, dueAt };
}

const statusOf = (id: string) =>
  client.db.select().from(registrations).where(eq(registrations.id, id)).get()?.status;
const notices = (kind: string) =>
  client.db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.type, 'notify'))
    .all()
    .filter((row) => (row.payloadJson as { kind?: string }).kind === kind);
const markPaid = (registrationId: string) =>
  client.db
    .update(paymentRequests)
    .set({ status: 'paid' })
    .where(eq(paymentRequests.registrationId, registrationId))
    .run();

it('releases at the deadline without grace and hands the seat to the oldest waiter', async () => {
  const fixture = await scheduled(1, { kind: 'auto', graceDays: 0 });
  const unpaid = await fixture.join();
  // Waiters are ordered by join time; distinct instants keep the order deterministic.
  fixedClock.advance(1);
  const waiting = await fixture.join('200000000000000003');
  fixedClock.advance(1);
  const later = await fixture.join('200000000000000004');
  expect([unpaid.status, waiting.status, later.status]).toEqual([
    'confirmed',
    'waitlisted',
    'waitlisted'
  ]);
  tickOnce(client, fixture.opensAt);
  tickOnce(client, fixture.dueAt);
  expect(statusOf(unpaid.id)).toBe('cancelled');
  // The collection is open, so the promoted waiter holds the seat and pays immediately.
  expect(statusOf(waiting.id)).toBe('held');
  expect(statusOf(later.id)).toBe('waitlisted');
  expect(
    client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.registrationId, waiting.id))
      .all()
  ).toHaveLength(1);
  expect(notices('waitlist_confirmed')).toHaveLength(1);
  expect(notices('payment_overdue')).toHaveLength(1);
  // An immediate release needs no separate past-due notice.
  expect(notices('payment_past_due')).toHaveLength(0);
});

it('notifies once at the deadline, accepts payment during grace, then releases', async () => {
  const fixture = await scheduled(2, { kind: 'auto', graceDays: 2 });
  const unpaid = await fixture.join();
  const payer = await fixture.join('200000000000000003');
  const waiting = await fixture.join('200000000000000004');
  tickOnce(client, fixture.opensAt);
  tickOnce(client, fixture.dueAt);
  tickOnce(client, new Date(fixture.dueAt.getTime() + day));
  expect(notices('payment_past_due')).toHaveLength(2);
  expect(
    client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.registrationId, unpaid.id))
      .get()?.overdueNotifiedAt
  ).toEqual(fixture.dueAt);
  expect(statusOf(unpaid.id)).toBe('confirmed');

  markPaid(payer.id);
  tickOnce(client, new Date(fixture.dueAt.getTime() + 2 * day - 1));
  expect(statusOf(unpaid.id)).toBe('confirmed');
  tickOnce(client, new Date(fixture.dueAt.getTime() + 2 * day));
  expect(statusOf(unpaid.id)).toBe('cancelled');
  expect(statusOf(payer.id)).toBe('confirmed');
  expect(statusOf(waiting.id)).toBe('held');
});

it('never releases a manual policy automatically; the organizer releases and promotes', async () => {
  const fixture = await scheduled(2, { kind: 'manual', graceDays: 0 });
  const unpaid = await fixture.join();
  const checkedIn = await fixture.join('200000000000000003');
  const waiting = await fixture.join('200000000000000004');
  tickOnce(client, fixture.opensAt);
  write(client, (tx) => {
    tx.insert(checkinRecords)
      .values({
        eventId: fixture.event.id,
        registrationId: checkedIn.id,
        actorUserId: fixture.owner.userId,
        status: 'checked_in',
        method: 'search',
        createdAt: fixedClock.now()
      })
      .run();
  });
  tickOnce(client, fixture.dueAt);
  tickOnce(client, new Date(fixture.dueAt.getTime() + 40 * day));
  expect(statusOf(unpaid.id)).toBe('confirmed');
  // Checked-in attendance is not overdue: staff collect at the door.
  expect(notices('payment_past_due_manual')).toHaveLength(1);

  fixedClock.advance(fixture.dueAt.getTime() - fixedClock.now().getTime() + day);
  const dashboard = getEventDashboard(client, fixture.owner.userId, fixture.event.id, fixedClock);
  expect(dashboard.paymentSchedule.overduePolicy).toEqual({ kind: 'manual', graceDays: 0 });
  expect(dashboard.paymentSchedule.overdueCount).toBe(1);

  const release = (expectedRegistrationIds: string[]) =>
    releaseOverdueRegistrations(
      client,
      { actorUserId: fixture.owner.userId, eventId: fixture.event.id, expectedRegistrationIds },
      fixedClock
    );
  const shown = listReleasableOverdue(client, fixture.owner.userId, fixture.event.id, fixedClock);
  expect(shown.map((row) => row.registrationId)).toEqual([unpaid.id]);
  // A list that no longer matches (here: someone the organizer never saw) releases nobody.
  expect(() => release([unpaid.id, checkedIn.id])).toThrow(
    expect.objectContaining({ code: 'conflict' })
  );
  expect(statusOf(unpaid.id)).toBe('confirmed');
  expect(release([unpaid.id])).toBe(1);
  expect(statusOf(unpaid.id)).toBe('cancelled');
  expect(statusOf(checkedIn.id)).toBe('confirmed');
  expect(statusOf(waiting.id)).toBe('held');
  expect(
    client.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'registration.payment_overdue'), eq(auditLogs.targetId, unpaid.id))
      )
      .all()
      .map((row) => row.actorUserId)
  ).toEqual([fixture.owner.userId]);

  // Repeating the action or a later tick releases nobody twice.
  expect(release([])).toBe(0);
  tickOnce(client, fixedClock.now());
  expect(notices('payment_overdue')).toHaveLength(1);
});

it('refuses the bulk release on automatic policies, whose schedule participants were shown', async () => {
  const fixture = await scheduled(2, { kind: 'auto', graceDays: 3 });
  await expect(async () =>
    releaseOverdueRegistrations(
      client,
      { actorUserId: fixture.owner.userId, eventId: fixture.event.id, expectedRegistrationIds: [] },
      fixedClock
    )
  ).rejects.toMatchObject({ code: 'validation' });
});

it('leaves participants paying in an open Checkout out of the bulk release', async () => {
  const fixture = await scheduled(2, { kind: 'manual', graceDays: 0 });
  const paying = await fixture.join();
  tickOnce(client, fixture.opensAt);
  fixedClock.advance(fixture.dueAt.getTime() - fixedClock.now().getTime() + day);
  client.db
    .update(paymentRequests)
    .set({
      status: 'payment_pending',
      checkoutSessionId: 'cs_live',
      checkoutExpiresAt: new Date(fixedClock.now().getTime() + 30 * 60_000)
    })
    .where(eq(paymentRequests.registrationId, paying.id))
    .run();
  expect(listReleasableOverdue(client, fixture.owner.userId, fixture.event.id, fixedClock)).toEqual(
    []
  );
  // Expiry alone is not enough: a payment finished at the last moment may still be reported.
  fixedClock.advance(30 * 60_000);
  expect(listReleasableOverdue(client, fixture.owner.userId, fixture.event.id, fixedClock)).toEqual(
    []
  );
  // Shortly after the session has expired the participant is releasable again.
  fixedClock.advance(checkoutSettlementSlackMs);
  expect(
    listReleasableOverdue(client, fixture.owner.userId, fixture.event.id, fixedClock).map(
      (row) => row.registrationId
    )
  ).toEqual([paying.id]);
});

it('notifies again after an extended deadline passes', async () => {
  const fixture = await scheduled(2, { kind: 'manual', graceDays: 0 });
  const unpaid = await fixture.join();
  tickOnce(client, fixture.opensAt);
  tickOnce(client, fixture.dueAt);
  expect(notices('payment_past_due_manual')).toHaveLength(1);
  const extended = new Date(fixture.dueAt.getTime() + 5 * day);
  write(client, (tx) => {
    const event = tx
      .update(events)
      .set({ paymentDueAt: extended })
      .where(eq(events.id, fixture.event.id))
      .returning()
      .get()!;
    configureEventPayment(
      tx,
      event,
      { paymentRequirement: 'pay_later' },
      fixedClock,
      defaultTuning
    );
  });
  const request = () =>
    client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.registrationId, unpaid.id))
      .get()!;
  expect(request()).toMatchObject({ dueAt: extended, overdueNotifiedAt: null, remindedAt: null });
  tickOnce(client, extended);
  expect(request().overdueNotifiedAt).toEqual(extended);
});

it('only loosens the policy once payment requests exist', async () => {
  const fixture = await scheduled(2, { kind: 'auto', graceDays: 2 });
  await fixture.join();
  const event = client.db.select().from(events).where(eq(events.id, fixture.event.id)).get()!;
  const zone = 'Asia/Tokyo';
  const settings = (
    overdueRelease: 'auto' | 'manual',
    overdueGraceDays: number,
    dueAt = fixture.dueAt
  ) =>
    updateSettings(
      client,
      {
        actorUserId: fixture.owner.userId,
        eventId: event.id,
        title: event.title,
        description: event.description,
        startsAt: formatWallClockInput(event.startsAt, zone),
        endsAt: formatWallClockInput(event.endsAt, zone),
        capacity: event.capacity,
        venueName: event.venueName,
        venueAddress: event.venueAddress,
        venueReveal: 'public',
        contact: event.contact,
        cancellationPolicy: event.cancellationPolicy,
        registrationOpensAt: formatWallClockInput(event.registrationOpensAt, zone),
        registrationClosesAt: formatWallClockInput(event.registrationClosesAt, zone),
        paymentRequirement: 'pay_later',
        amountToCollect: '5000',
        roundingUnit: 100,
        paymentOpensAt: formatWallClockInput(fixture.opensAt, zone),
        paymentDueAt: formatWallClockInput(dueAt, zone),
        registrationMode: 'auto_confirm',
        overdueRelease,
        overdueGraceDays,
        timeZone: zone
      },
      fixedClock
    );
  const stored = () => {
    const row = client.db.select().from(events).where(eq(events.id, event.id)).get()!;
    return [row.overdueRelease, row.overdueGraceDays];
  };

  // Before any obligation, the organizer may tighten freely.
  await settings('auto', 0);
  expect(stored()).toEqual(['auto', 0]);
  await settings('auto', 2);
  tickOnce(client, fixture.opensAt);

  await expect(settings('auto', 1)).rejects.toMatchObject({ code: 'overdue_policy_tightened' });
  await settings('auto', 5);
  expect(stored()).toEqual(['auto', 5]);
  // Organizer judgement keeps the announced grace period; dropping it would tighten the rule.
  await expect(settings('manual', 0)).rejects.toMatchObject({ code: 'overdue_policy_tightened' });
  await settings('manual', 5);
  expect(stored()).toEqual(['manual', 5]);
  await expect(settings('auto', 30)).rejects.toMatchObject({ code: 'overdue_policy_tightened' });
  // An earlier deadline tightens exactly like a shorter grace period, unless the grace makes up for it.
  const earlier = new Date(fixture.dueAt.getTime() - 2 * day);
  await expect(settings('manual', 5, earlier)).rejects.toMatchObject({
    code: 'overdue_policy_tightened'
  });
  await settings('manual', 7, earlier);
  expect(stored()).toEqual(['manual', 7]);
  await expect(settings('manual', 31, earlier)).rejects.toMatchObject({ code: 'validation' });
});

it('keeps the announced grace period after switching from automatic to manual', async () => {
  const fixture = await scheduled(2, { kind: 'auto', graceDays: 7 });
  const unpaid = await fixture.join();
  tickOnce(client, fixture.opensAt);
  tickOnce(client, fixture.dueAt);
  expect(notices('payment_past_due')).toHaveLength(1);
  // The organizer switches to manual within the announced week.
  client.db
    .update(events)
    .set(overduePolicyColumns({ kind: 'manual', graceDays: 7 }))
    .where(eq(events.id, fixture.event.id))
    .run();
  fixedClock.advance(fixture.dueAt.getTime() - fixedClock.now().getTime() + 6 * day);
  expect(listReleasableOverdue(client, fixture.owner.userId, fixture.event.id, fixedClock)).toEqual(
    []
  );
  expect(() =>
    releaseOverdueRegistrations(
      client,
      {
        actorUserId: fixture.owner.userId,
        eventId: fixture.event.id,
        expectedRegistrationIds: [unpaid.id]
      },
      fixedClock
    )
  ).toThrow(expect.objectContaining({ code: 'conflict' }));
  expect(statusOf(unpaid.id)).toBe('confirmed');
  // The worker never releases a manual policy, even after the grace period.
  tickOnce(client, new Date(fixture.dueAt.getTime() + 8 * day));
  expect(statusOf(unpaid.id)).toBe('confirmed');
  fixedClock.advance(day);
  expect(
    releaseOverdueRegistrations(
      client,
      {
        actorUserId: fixture.owner.userId,
        eventId: fixture.event.id,
        expectedRegistrationIds: [unpaid.id]
      },
      fixedClock
    )
  ).toBe(1);
});

it('waits for an open Checkout before releasing automatically, like the organizer release', async () => {
  const fixture = await scheduled(1, { kind: 'auto', graceDays: 0 });
  const paying = await fixture.join();
  fixedClock.advance(1);
  const waiting = await fixture.join('200000000000000003');
  tickOnce(client, fixture.opensAt);
  const checkoutExpiresAt = new Date(fixture.dueAt.getTime() + 40 * 60_000);
  client.db
    .update(paymentRequests)
    .set({ status: 'payment_pending', checkoutExpiresAt })
    .where(eq(paymentRequests.registrationId, paying.id))
    .run();
  tickOnce(client, fixture.dueAt);
  tickOnce(client, checkoutExpiresAt);
  // Releasing now would turn a payment in progress into a refund.
  expect(statusOf(paying.id)).toBe('confirmed');
  expect(statusOf(waiting.id)).toBe('waitlisted');
  tickOnce(client, new Date(checkoutExpiresAt.getTime() + checkoutSettlementSlackMs));
  expect(statusOf(paying.id)).toBe('cancelled');
  expect(statusOf(waiting.id)).toBe('held');
  // The promotion audit records the state the seat actually entered.
  const promoted = client.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'registration.promote'), eq(auditLogs.targetId, waiting.id)))
    .get()!;
  expect(promoted.afterJson).toMatchObject({ status: 'held' });
});

it('lets a payment completed in the open Checkout keep the seat', async () => {
  const fixture = await scheduled(1, { kind: 'auto', graceDays: 0 });
  const paying = await fixture.join();
  tickOnce(client, fixture.opensAt);
  client.db
    .update(paymentRequests)
    .set({
      status: 'payment_pending',
      checkoutExpiresAt: new Date(fixture.dueAt.getTime() + 40 * 60_000)
    })
    .where(eq(paymentRequests.registrationId, paying.id))
    .run();
  tickOnce(client, fixture.dueAt);
  markPaid(paying.id);
  tickOnce(client, new Date(fixture.dueAt.getTime() + 60 * 60_000));
  expect(statusOf(paying.id)).toBe('confirmed');
});

it('lets the opening notice stand in for the reminder when the window is shorter than the lead', async () => {
  const short = await scheduled(2, { kind: 'auto', graceDays: 0 }, 10);
  await short.join();
  tickOnce(client, short.opensAt);
  tickOnce(client, new Date(short.opensAt.getTime() + 60_000));
  expect(notices('payment_open')).toHaveLength(1);
  expect(notices('payment_due_soon')).toHaveLength(0);
});

it('still reminds before the deadline when the window is longer than the lead', async () => {
  const long = await scheduled(2, { kind: 'auto', graceDays: 0 });
  await long.join();
  tickOnce(client, long.opensAt);
  expect(notices('payment_due_soon')).toHaveLength(0);
  tickOnce(
    client,
    new Date(long.dueAt.getTime() - defaultTuning.OFFKAI_PAYMENT_REMINDER_LEAD_HOURS * 3_600_000)
  );
  expect(notices('payment_open')).toHaveLength(1);
  expect(notices('payment_due_soon')).toHaveLength(1);
});

it.each([false, true])(
  'stores an organizer-decided policy chosen at creation (copying a previous event: %s)',
  async (copy) => {
    const base = await paidEvent(client, 'pay_later', 2);
    const created = await createEvent(
      client,
      {
        actorUserId: base.owner.userId,
        organizationId: base.org.id,
        ...(copy ? { copyFromEventId: base.event.id } : {}),
        title: 'Manual policy',
        startsAt: '2027-03-01T19:00',
        capacity: 2,
        paymentRequirement: 'pay_later',
        amountToCollect: '1000',
        roundingUnit: 10,
        paymentOpensAt: '2027-02-01T12:00',
        paymentDueAt: '2027-02-10T12:00',
        overdueRelease: 'manual',
        overdueGraceDays: 3,
        timeZone: 'Asia/Tokyo'
      },
      undefined,
      fixedClock
    );
    const stored = client.db.select().from(events).where(eq(events.id, created.id)).get()!;
    expect([stored.overdueRelease, stored.overdueGraceDays]).toEqual(['manual', 3]);
  }
);
