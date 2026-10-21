import { expect, it } from 'vitest';
import fc from 'fast-check';
import { grossUp, feeBreakdown, effectiveHoldMinutes } from '$lib/shared/fees';
import { notificationRoute } from '$lib/server/domain/notifications/route';
it.each([
  [1000n, 360, 0, 1, 1038n],
  [1000n, 360, 200, 100, 1100n],
  [5000n, 360, 0, 100, 5200n],
  [1n, 0, 0, 10, 10n],
  [0n, 360, 200, 100, 0n],
  [1000n, 0, 0, 1, 1000n]
])('grosses up %s at %s/%s to unit %s', (net, stripe, platform, unit, expected) => {
  expect(grossUp(net as bigint, stripe as number, platform as number, unit as number)).toBe(
    expected
  );
});
it('preserves net, unit divisibility and monotonic rates with integer money', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 99999999n }),
      fc.integer({ min: 0, max: 4000 }),
      fc.integer({ min: 0, max: 4000 }),
      fc.constantFrom(1, 10, 100),
      (net, stripe, platform, unit) => {
        const price = grossUp(net, stripe, platform, unit);
        expect(feeBreakdown(price, stripe, platform).takeHome).toBeGreaterThanOrEqual(net);
        expect(price % BigInt(unit)).toBe(0n);
        expect(grossUp(net, stripe + 1, platform, unit)).toBeGreaterThanOrEqual(price);
        expect(grossUp(net, stripe, platform + 1, unit)).toBeGreaterThanOrEqual(price);
        expect(feeBreakdown(price, stripe, 0).platformFee).toBe(0n);
      }
    ),
    { numRuns: 1000 }
  );
});
it('clamps to Stripe minimum without accepting out-of-bound organizer input', () => {
  expect(effectiveHoldMinutes(10, 5, 60)).toBe(30);
  expect(effectiveHoldMinutes(60, 30, 90)).toBe(60);
  expect(() => effectiveHoldMinutes(1, 5, 60)).toThrow();
});
it.each([
  [403, 50007, 'thread'],
  [403, 50278, 'thread'],
  [404, 10007, 'stop'],
  [403, 50013, 'stop'],
  [429, 0, 'retry'],
  [500, 0, 'retry'],
  [400, 50007, 'stop']
])('routes Discord %s/%s to %s', (status, code, expected) => {
  expect(notificationRoute(Number(status), Number(code))).toBe(expected);
});
