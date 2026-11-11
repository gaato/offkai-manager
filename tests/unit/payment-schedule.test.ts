import { describe, expect, it } from 'vitest';
import { validatePaymentSchedule, type EventPaymentForm } from '$lib/shared/event-payment-form';

const base: EventPaymentForm & { startsAt: string } = {
  paymentRequirement: 'pay_later',
  amountToCollect: '1000',
  roundingUnit: 1,
  priceOverride: '',
  pricePending: false,
  paymentOpensAt: '2027-01-01T10:00',
  paymentDueAt: '2027-01-02T10:00',
  additionalOpensAt: '',
  overdueRelease: 'auto',
  overdueGraceDays: 0,
  manualCash: true,
  manualPayPay: true,
  holdMinutes: 30,
  startsAt: '2027-01-03T10:00'
};

const messages = {
  datetime: 'datetime',
  dueRequired: 'due',
  order: 'order',
  additional: 'additional',
  pending: 'pending',
  grace: 'grace'
};

describe('payment schedule form validation', () => {
  it.each([
    [{ paymentDueAt: '' }, ['paymentDueAt', 'due']],
    [{ paymentDueAt: '2027-01-01T09:00' }, ['paymentDueAt', 'order']],
    [{ paymentDueAt: '2027-01-04T09:00' }, ['paymentDueAt', 'order']],
    [{ additionalOpensAt: '2027-01-01T09:00' }, ['additionalOpensAt', 'additional']],
    [{ paymentRequirement: 'none' as const, pricePending: true }, ['pricePending', 'pending']],
    // Due 2027-01-02T10:00 + 1 day reaches the start at 2027-01-03T10:00.
    [{ overdueGraceDays: 1 }, ['overdueGraceDays', 'grace']],
    [{ overdueRelease: 'manual' as const, overdueGraceDays: 5 }, ['overdueGraceDays', 'grace']]
  ])('rejects %o', (change, expected) => {
    const issues: [string, string][] = [];
    validatePaymentSchedule(
      { ...base, ...change },
      (field, message) => issues.push([field, message]),
      messages
    );
    expect(issues).toContainEqual(expected);
  });

  it('accepts a grace period of either kind that ends before the start', () => {
    for (const change of [
      { overdueRelease: 'manual' as const, paymentDueAt: '2027-01-02T09:59', overdueGraceDays: 1 },
      { paymentDueAt: '2027-01-02T09:59', overdueGraceDays: 1 }
    ]) {
      const issues: [string, string][] = [];
      validatePaymentSchedule(
        { ...base, ...change },
        (field, message) => issues.push([field, message]),
        messages
      );
      expect(issues).toEqual([]);
    }
  });

  it('accepts an ordered schedule and pending structural price', () => {
    const issues: [string, string][] = [];
    validatePaymentSchedule(
      { ...base, pricePending: true, additionalOpensAt: base.paymentOpensAt },
      (field, message) => issues.push([field, message]),
      messages
    );
    expect(issues).toEqual([]);
  });
});
