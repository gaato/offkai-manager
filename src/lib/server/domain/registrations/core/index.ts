import type { RegistrationMode } from '$lib/shared/event';

/** Attendance lifecycle only: confirmation makes no assertion about payment. */
export type RegistrationState =
  | { readonly kind: 'none' }
  | { readonly kind: 'applied' }
  | { readonly kind: 'waitlisted' }
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'cancelled' };

export type RegistrationCommand =
  | { readonly type: 'join' }
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
}
export type RegistrationEffect =
  { readonly type: 'syncRoles' } | { readonly type: 'refreshPanels' } | { readonly type: 'audit' };
export type Rejection = {
  readonly ok: false;
  readonly code:
    'duplicate' | 'not_registrable' | 'not_withdrawable' | 'illegal_transition' | 'capacity';
};
export type Decision =
  | {
      readonly ok: true;
      readonly next: RegistrationState;
      readonly effects: readonly RegistrationEffect[];
    }
  | Rejection;

function transition(kind: RegistrationState['kind'], roles = true): Decision {
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
  const full = context.capacity !== null && context.confirmedCount >= context.capacity;
  if (state.kind === 'cancelled') return { ok: false, code: 'illegal_transition' };
  switch (command.type) {
    case 'join':
      if (state.kind !== 'none') return { ok: false, code: 'duplicate' };
      if (!context.accepting || context.now < context.opensAt || context.now > context.closesAt)
        return { ok: false, code: 'not_registrable' };
      return transition(
        context.registrationMode === 'approval' ? 'applied' : full ? 'waitlisted' : 'confirmed',
        context.registrationMode === 'auto_confirm' && !full
      );
    case 'editAnswers':
      if (state.kind === 'none') return { ok: false, code: 'illegal_transition' };
      if (!context.accepting || context.now >= context.startsAt)
        return { ok: false, code: 'not_registrable' };
      return transition(state.kind, false);
    case 'cancel':
      if (state.kind === 'none' || context.now >= context.startsAt)
        return { ok: false, code: 'not_withdrawable' };
      return transition('cancelled');
    case 'promote':
      if (state.kind !== 'waitlisted') return { ok: false, code: 'illegal_transition' };
      if (full) return { ok: false, code: 'capacity' };
      return transition('confirmed');
    case 'setStatus':
      if (state.kind === 'none' || state.kind === command.status)
        return { ok: false, code: 'illegal_transition' };
      if (command.status === 'confirmed' && full) return { ok: false, code: 'capacity' };
      return transition(command.status);
    default:
      return command satisfies never;
  }
}
