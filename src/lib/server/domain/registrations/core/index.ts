import type { PaymentRequirement } from '$lib/shared/payment';
import type { RegistrationMode } from '$lib/shared/event';

/** Attendance lifecycle only: confirmation makes no assertion about payment. */
export type RegistrationState =
  | { readonly kind: 'none' }
  | { readonly kind: 'applied' }
  | { readonly kind: 'waitlisted' }
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'held'; readonly holdExpiresAt: Date }
  | { readonly kind: 'cancelled' };

export type PaymentState =
  | { readonly kind: 'unpaid' }
  | { readonly kind: 'checkout_open'; readonly sessionId: string; readonly expiresAt: Date }
  | { readonly kind: 'paid'; readonly recordId: string }
  | { readonly kind: 'waived' }
  | { readonly kind: 'refund_due'; readonly recordId: string };

export type RegistrationCommand =
  | { readonly type: 'join' }
  | { readonly type: 'startCheckout'; readonly sessionId: string; readonly expiresAt: Date }
  | { readonly type: 'paymentSucceeded'; readonly recordId: string }
  | { readonly type: 'manualPaid'; readonly recordId: string }
  | { readonly type: 'waive' }
  | { readonly type: 'holdExpired' }
  | { readonly type: 'editAnswers' }
  | { readonly type: 'cancel' }
  | { readonly type: 'promote' }
  // The shell must authorize organizers before passing this command.
  | { readonly type: 'setStatus'; readonly status: 'confirmed' | 'waitlisted' | 'cancelled' };

export interface RegistrationContext {
  readonly now: Date;
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly startsAt: Date;
  readonly accepting: boolean;
  readonly capacity: number | null;
  readonly confirmedCount: number;
  readonly registrationMode: RegistrationMode;
  readonly paymentRequirement?: PaymentRequirement;
  readonly holdMinutes?: number;
  readonly heldCount?: number;
  readonly payment?: PaymentState;
  /** A check-in record exists; staff undo it before the attendance can be released. */
  readonly checkedIn?: boolean;
}
export type RegistrationEffect =
  { readonly type: 'syncRoles' } | { readonly type: 'refreshPanels' } | { readonly type: 'audit' };
export type Rejection = {
  readonly ok: false;
  readonly code:
    | 'duplicate'
    | 'not_registrable'
    | 'not_withdrawable'
    | 'checked_in'
    | 'illegal_transition'
    | 'capacity';
};
export type Decision =
  | {
      readonly ok: true;
      readonly next: RegistrationState;
      readonly effects: readonly RegistrationEffect[];
      readonly payment?: PaymentState;
    }
  | Rejection;

function transition(
  kind: Exclude<RegistrationState['kind'], 'held'>,
  roles = true
): Extract<Decision, { ok: true }> {
  return {
    ok: true,
    next: { kind },
    effects: [
      { type: 'audit' },
      ...(roles ? [{ type: 'syncRoles' } as const] : []),
      { type: 'refreshPanels' }
    ]
  };
}

export function decide(
  state: RegistrationState,
  command: RegistrationCommand,
  context: RegistrationContext
): Decision {
  const full =
    context.capacity !== null &&
    context.confirmedCount + (context.heldCount ?? 0) >= context.capacity;
  const payment = context.payment ?? { kind: 'unpaid' };
  const paid = (recordId: string): Decision => {
    if (
      !recordId ||
      state.kind === 'none' ||
      state.kind === 'applied' ||
      state.kind === 'waitlisted' ||
      payment.kind === 'paid' ||
      payment.kind === 'refund_due'
    )
      return { ok: false, code: 'illegal_transition' };
    const released =
      state.kind === 'cancelled' || (state.kind === 'held' && state.holdExpiresAt <= context.now);
    return {
      ok: true,
      next: released
        ? state.kind === 'held'
          ? { kind: 'cancelled' }
          : state
        : payment.kind === 'waived'
          ? state
          : { kind: 'confirmed' },
      payment: { kind: released || payment.kind === 'waived' ? 'refund_due' : 'paid', recordId },
      effects: [{ type: 'audit' }, { type: 'syncRoles' }, { type: 'refreshPanels' }]
    };
  };
  if (command.type === 'paymentSucceeded' || command.type === 'manualPaid')
    return paid(command.recordId);
  const admission = (): Decision =>
    context.paymentRequirement === 'pay_to_confirm'
      ? {
          ok: true,
          next: {
            kind: 'held',
            holdExpiresAt: new Date(
              context.now.getTime() + Math.max(30, context.holdMinutes ?? 30) * 60000
            )
          },
          payment: { kind: 'unpaid' },
          effects: [{ type: 'audit' }, { type: 'refreshPanels' }]
        }
      : { ...transition('confirmed'), payment: { kind: 'unpaid' } };
  if (state.kind === 'cancelled') return { ok: false, code: 'illegal_transition' };
  switch (command.type) {
    case 'join':
      if (state.kind !== 'none') return { ok: false, code: 'duplicate' };
      if (!context.accepting || context.now < context.opensAt || context.now > context.closesAt)
        return { ok: false, code: 'not_registrable' };
      return context.registrationMode === 'approval'
        ? transition('applied', false)
        : full
          ? transition('waitlisted', false)
          : admission();
    case 'startCheckout':
      if (
        (state.kind !== 'held' && state.kind !== 'confirmed') ||
        (state.kind === 'held' && state.holdExpiresAt <= context.now) ||
        !['unpaid', 'checkout_open'].includes(payment.kind) ||
        command.expiresAt <= context.now
      )
        return { ok: false, code: 'illegal_transition' };
      return {
        ok: true,
        next: state,
        payment: {
          kind: 'checkout_open',
          sessionId: command.sessionId,
          expiresAt: command.expiresAt
        },
        effects: [{ type: 'audit' }, { type: 'refreshPanels' }]
      };
    case 'holdExpired':
      if (state.kind !== 'held' || state.holdExpiresAt > context.now)
        return { ok: false, code: 'illegal_transition' };
      return transition('cancelled');
    case 'waive':
      if (
        (state.kind !== 'held' && state.kind !== 'confirmed') ||
        !['unpaid', 'checkout_open'].includes(payment.kind) ||
        (state.kind === 'held' && state.holdExpiresAt <= context.now)
      )
        return { ok: false, code: 'illegal_transition' };
      return { ...transition('confirmed'), payment: { kind: 'waived' } };
    case 'editAnswers':
      if (state.kind === 'none') return { ok: false, code: 'illegal_transition' };
      if (!context.accepting || context.now >= context.startsAt)
        return { ok: false, code: 'not_registrable' };
      return { ok: true, next: state, effects: [{ type: 'audit' }, { type: 'refreshPanels' }] };
    case 'cancel':
      if (context.checkedIn) return { ok: false, code: 'checked_in' };
      if (state.kind === 'none' || context.now >= context.startsAt)
        return { ok: false, code: 'not_withdrawable' };
      return {
        ...transition('cancelled'),
        ...(payment.kind === 'paid'
          ? { payment: { kind: 'refund_due' as const, recordId: payment.recordId } }
          : {})
      };
    case 'promote':
      if (state.kind !== 'waitlisted') return { ok: false, code: 'illegal_transition' };
      if (full) return { ok: false, code: 'capacity' };
      return admission();
    case 'setStatus':
      if (state.kind === 'none' || state.kind === command.status)
        return { ok: false, code: 'illegal_transition' };
      if (context.checkedIn && command.status !== 'confirmed')
        return { ok: false, code: 'checked_in' };
      if (command.status === 'confirmed' && full) return { ok: false, code: 'capacity' };
      return command.status === 'confirmed' ? admission() : transition(command.status);
    default:
      return command satisfies never;
  }
}

/** Shells must carry the deadline when materializing a held attendance state. */
export function attendanceState(row: {
  status: string;
  holdExpiresAt?: Date | null;
}): RegistrationState {
  if (row.status === 'held') {
    if (!row.holdExpiresAt) throw new Error('held registration has no deadline');
    return { kind: 'held', holdExpiresAt: row.holdExpiresAt };
  }
  return { kind: row.status as Exclude<RegistrationState['kind'], 'held'> };
}
