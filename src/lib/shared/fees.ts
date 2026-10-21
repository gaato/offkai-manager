/** Integer-only gross-up: round estimated fees up so the displayed take-home is conservative. */
const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;
export function feeBreakdown(price: bigint, stripeBps: number, platformBps: number) {
  validate(price, stripeBps, platformBps, 1);
  const stripeFee = ceilDiv(price * BigInt(stripeBps), 10000n);
  const platformFee = (price * BigInt(platformBps)) / 10000n;
  return { price, stripeFee, platformFee, takeHome: price - stripeFee - platformFee };
}
export function grossUp(net: bigint, stripeBps: number, platformBps: number, unit: number) {
  validate(net, stripeBps, platformBps, unit);
  const raw = ceilDiv(net * 10000n, BigInt(10000 - stripeBps - platformBps));
  return ceilDiv(raw, BigInt(unit)) * BigInt(unit);
}
function validate(net: bigint, stripe: number, platform: number, unit: number) {
  if (
    net < 0n ||
    ![stripe, platform, unit].every(Number.isSafeInteger) ||
    stripe < 0 ||
    platform < 0 ||
    stripe + platform >= 10000 ||
    unit < 1
  )
    throw new RangeError('invalid fee calculation');
}
/** Stripe accepts sessions 30 minutes to 24 hours out; holds use the same deadline. */
export function effectiveHoldMinutes(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max || min > max || max < 30 || max > 1440)
    throw new RangeError('invalid hold duration');
  return Math.max(30, value);
}
