import { describe, expect, it } from 'vitest';
import {
  checkoutSettlementSlackMs,
  isReleasableNow,
  type OverdueRow
} from '$lib/server/domain/payments/overdue';

const dueAt = new Date('2027-02-10T03:00:00Z');
const day = 24 * 60 * 60_000;
function row(
  request: Partial<OverdueRow['request']>,
  policy: { overdueRelease: 'auto' | 'manual'; overdueGraceDays: number } = {
    overdueRelease: 'auto',
    overdueGraceDays: 0
  }
): OverdueRow {
  return {
    request: { status: 'pending', checkoutExpiresAt: null, ...request } as OverdueRow['request'],
    registration: {} as OverdueRow['registration'],
    event: { paymentDueAt: dueAt, ...policy } as OverdueRow['event']
  };
}

describe('isReleasableNow', () => {
  it('waits for the announced grace period under both policies', () => {
    for (const overdueRelease of ['auto', 'manual'] as const) {
      const graced = row({}, { overdueRelease, overdueGraceDays: 2 });
      expect(isReleasableNow(graced, new Date(dueAt.getTime() + 2 * day - 1))).toBe(false);
      expect(isReleasableNow(graced, new Date(dueAt.getTime() + 2 * day))).toBe(true);
    }
  });

  it('waits while Checkout is open, plus time for a late webhook, then releases', () => {
    const checkoutExpiresAt = new Date(dueAt.getTime() + 40 * 60_000);
    const settled = new Date(checkoutExpiresAt.getTime() + checkoutSettlementSlackMs);
    const paying = row({ status: 'payment_pending', checkoutExpiresAt });
    expect(isReleasableNow(paying, dueAt)).toBe(false);
    expect(isReleasableNow(paying, checkoutExpiresAt)).toBe(false);
    expect(isReleasableNow(paying, new Date(settled.getTime() - 1))).toBe(false);
    expect(isReleasableNow(paying, settled)).toBe(true);
    // A pending request keeps a stale expiry from an abandoned session; that must not shield it.
    expect(isReleasableNow(row({ status: 'pending', checkoutExpiresAt }), dueAt)).toBe(true);
  });

  it('never releases without a scheduled deadline', () => {
    const unscheduled = { ...row({}), event: { ...row({}).event, paymentDueAt: null } };
    expect(isReleasableNow(unscheduled, new Date(dueAt.getTime() + 100 * day))).toBe(false);
  });
});
