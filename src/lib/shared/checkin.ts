export const checkInPaymentStates = ['none', 'unpaid', 'paid', 'waived'] as const;
export type CheckInPaymentState = (typeof checkInPaymentStates)[number];

export function checkInPaymentStateLabelKey(
  state: CheckInPaymentState
): `checkin.payment.${CheckInPaymentState}` {
  return `checkin.payment.${state}`;
}
