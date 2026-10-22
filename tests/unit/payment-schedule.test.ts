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
  pending: 'pending'
};

describe('payment schedule form validation', () => {
  it.each([
    [{ paymentDueAt: '' }, ['paymentDueAt', 'due']],
    [{ paymentDueAt: '2027-01-01T09:00' }, ['paymentDueAt', 'order']],
    [{ paymentDueAt: '2027-01-04T09:00' }, ['paymentDueAt', 'order']],
    [{ additionalOpensAt: '2027-01-01T09:00' }, ['additionalOpensAt', 'additional']],
    [{ paymentRequirement: 'none' as const, pricePending: true }, ['pricePending', 'pending']]
  ])('rejects %o', (change, expected) => {
    const issues: [string, string][] = [];
    validatePaymentSchedule(
      { ...base, ...change },
      (field, message) => issues.push([field, message]),
      messages
    );
    expect(issues).toContainEqual(expected);
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
