import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  decide,
  type RegistrationCommand,
  type RegistrationContext,
  type RegistrationState,
  type PaymentState
} from '$lib/server/domain/registrations/core';
const now = new Date('2026-10-21T00:00:00Z');
const context: RegistrationContext = {
  now,
  opensAt: new Date(0),
  closesAt: new Date('2027-01-01'),
  startsAt: new Date('2027-02-01'),
  accepting: true,
  capacity: 3,
  confirmedCount: 0,
  registrationMode: 'auto_confirm',
  paymentRequirement: 'pay_to_confirm',
  holdMinutes: 30
};
const commands: RegistrationCommand[] = [
  { type: 'join' },
  { type: 'editAnswers' },
  { type: 'cancel' },
  { type: 'promote' },
  { type: 'setStatus', status: 'confirmed' },
  { type: 'setStatus', status: 'waitlisted' },
  { type: 'setStatus', status: 'cancelled' },
  { type: 'startCheckout', sessionId: 'cs', expiresAt: new Date(now.getTime() + 1800000) },
  { type: 'paymentSucceeded', recordId: 'record' },
  { type: 'manualPaid', recordId: 'record' },
  { type: 'waive' },
  { type: 'holdExpired' }
];
const matrix: Record<RegistrationState['kind'], string[]> = {
  none: ['held', '!', '!', '!', '!', '!', '!', '!', '!', '!', '!', '!'],
  applied: [
    '!',
    'applied',
    'cancelled',
    '!',
    'held',
    'waitlisted',
    'cancelled',
    '!',
    '!',
    '!',
    '!',
    '!'
  ],
  waitlisted: [
    '!',
    'waitlisted',
    'cancelled',
    'held',
    'held',
    '!',
    'cancelled',
    '!',
    '!',
    '!',
    '!',
    '!'
  ],
  confirmed: [
    '!',
    'confirmed',
    'cancelled',
    '!',
    '!',
    'waitlisted',
    'cancelled',
    'confirmed',
    'confirmed',
    'confirmed',
    'confirmed',
    '!'
  ],
  held: [
    '!',
    'held',
    'cancelled',
    '!',
    'held',
    'waitlisted',
    'cancelled',
    'held',
    'confirmed',
    'confirmed',
    'confirmed',
    '!'
  ],
  cancelled: ['!', '!', '!', '!', '!', '!', '!', '!', 'cancelled', 'cancelled', '!', '!']
};
const state = (kind: RegistrationState['kind']): RegistrationState =>
  kind === 'held' ? { kind, holdExpiresAt: new Date(now.getTime() + 1800000) } : { kind };
describe('paid attendance decision matrix', () => {
  for (const [kind, expected] of Object.entries(matrix))
    commands.forEach((command, i) => {
      it(`${kind} × ${command.type} ${i}`, () => {
        const result = decide(state(kind as RegistrationState['kind']), command, context);
        expect(result.ok ? result.next.kind : '!').toBe(expected[i]);
        if (result.ok && (command.type === 'manualPaid' || command.type === 'paymentSucceeded'))
          expect(result.payment).toEqual({
            kind: kind === 'cancelled' ? 'refund_due' : 'paid',
            recordId: 'record'
          });
      });
    });
  it.each(['none', 'pay_later', 'pay_to_confirm'] as const)(
    'admits %s with separate payment state',
    (paymentRequirement) => {
      const result = decide({ kind: 'none' }, { type: 'join' }, { ...context, paymentRequirement });
      expect(result).toMatchObject({
        ok: true,
        next: { kind: paymentRequirement === 'pay_to_confirm' ? 'held' : 'confirmed' },
        payment: { kind: 'unpaid' }
      });
    }
  );
  it.each(['paid', 'waived', 'refund_due'] as const)(
    'does not reopen %s payment for checkout',
    (kind) => {
      const payment: PaymentState = kind === 'waived' ? { kind } : { kind, recordId: 'r' };
      for (const command of [commands[7], commands[10]])
        expect(decide(state('confirmed'), command, { ...context, payment })).toMatchObject({
          ok: false
        });
    }
  );
  it('expires exactly at the deadline and routes late funds to a refund conflict', () => {
    const held: RegistrationState = { kind: 'held', holdExpiresAt: now };
    expect(decide(held, { type: 'holdExpired' }, context)).toMatchObject({
      ok: true,
      next: { kind: 'cancelled' }
    });
    expect(decide(held, { type: 'paymentSucceeded', recordId: 'late' }, context)).toMatchObject({
      ok: true,
      next: { kind: 'cancelled' },
      payment: { kind: 'refund_due', recordId: 'late' }
    });
  });
  it('model-checks seat allocation, immutable releases and recorded money over command sequences', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(
          fc.record({
            actor: fc.integer({ min: 0, max: 9 }),
            action: fc.constantFrom('join', 'pay', 'expire', 'cancel')
          }),
          { maxLength: 200 }
        ),
        (capacity, steps) => {
          const seats = new Set<number>();
          const released = new Set<number>();
          const joined = new Set<number>();
          const records = new Set<string>();
          const actual: RegistrationState[] = Array.from({ length: 10 }, () => ({ kind: 'none' }));
          const payments: PaymentState[] = Array.from({ length: 10 }, () => ({ kind: 'unpaid' }));
          for (const [index, step] of steps.entries()) {
            const before = actual[step.actor];
            const deadline = before.kind === 'held' ? before.holdExpiresAt : now;
            const command: RegistrationCommand =
              step.action === 'pay'
                ? { type: 'paymentSucceeded', recordId: `record-${index}` }
                : { type: step.action === 'expire' ? 'holdExpired' : step.action };
            const clock = step.action === 'expire' ? deadline : now;
            const result = decide(before, command, {
              ...context,
              capacity,
              confirmedCount: seats.size,
              now: clock,
              payment: payments[step.actor]
            });
            if (step.action === 'join' && !joined.has(step.actor)) {
              joined.add(step.actor);
              if (seats.size < capacity) seats.add(step.actor);
            }
            if (
              (step.action === 'cancel' && ['held', 'confirmed'].includes(before.kind)) ||
              (step.action === 'expire' && before.kind === 'held')
            ) {
              seats.delete(step.actor);
              released.add(step.actor);
            }
            if (result.ok) {
              actual[step.actor] = result.next;
              if (result.payment) payments[step.actor] = result.payment;
              if (command.type === 'paymentSucceeded') records.add(command.recordId);
            }
            const occupied = actual.flatMap((value, actor) =>
              ['held', 'confirmed'].includes(value.kind) ? [actor] : []
            );
            expect(new Set(occupied)).toEqual(seats);
            expect(occupied.length).toBeLessThanOrEqual(capacity);
            if (before.kind === 'cancelled') expect(actual[step.actor]).toEqual(before);
            for (const actor of released) expect(occupied).not.toContain(actor);
            for (const payment of payments)
              if (payment.kind === 'paid') expect(records.has(payment.recordId)).toBe(true);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});

const paymentStates: PaymentState[] = [
  { kind: 'unpaid' },
  { kind: 'checkout_open', sessionId: 'cs', expiresAt: new Date(now.getTime() + 1800000) },
  { kind: 'paid', recordId: 'r' },
  { kind: 'waived' },
  { kind: 'refund_due', recordId: 'r' }
];
describe('attendance × payment × money command matrix', () => {
  for (const attendance of Object.keys(matrix) as RegistrationState['kind'][])
    for (const payment of paymentStates)
      for (const command of [commands[7], commands[8], commands[9], commands[10]]) {
        it(`${attendance}/${payment.kind}/${command.type}`, () => {
          const canPay =
            ['held', 'confirmed', 'cancelled'].includes(attendance) &&
            !['paid', 'refund_due'].includes(payment.kind);
          const canStartOrWaive =
            ['held', 'confirmed'].includes(attendance) &&
            ['unpaid', 'checkout_open'].includes(payment.kind);
          const money = command.type === 'paymentSucceeded' || command.type === 'manualPaid';
          const result = decide(state(attendance), command, { ...context, payment });
          expect(result.ok).toBe(money ? canPay : canStartOrWaive);
          if (result.ok && money) {
            expect(result.payment?.kind).toBe(
              attendance === 'cancelled' || payment.kind === 'waived' ? 'refund_due' : 'paid'
            );
            expect(result.next.kind).toBe(
              attendance === 'cancelled' || payment.kind === 'waived' ? attendance : 'confirmed'
            );
          }
        });
      }
});
