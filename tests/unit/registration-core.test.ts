import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  decide,
  type RegistrationCommand,
  type RegistrationContext,
  type RegistrationState
} from '$lib/server/domain/registrations/core';

const context: RegistrationContext = {
  now: new Date('2026-10-21T00:00:00Z'),
  opensAt: new Date('2026-01-01T00:00:00Z'),
  closesAt: new Date('2027-01-01T00:00:00Z'),
  startsAt: new Date('2027-01-02T00:00:00Z'),
  capacity: 2,
  confirmedCount: 0,
  registrationMode: 'auto_confirm',
  accepting: true
};
const commands: RegistrationCommand[] = [
  { type: 'join' },
  { type: 'editAnswers' },
  { type: 'cancel' },
  { type: 'promote' },
  { type: 'setStatus', status: 'confirmed' },
  { type: 'setStatus', status: 'waitlisted' },
  { type: 'setStatus', status: 'cancelled' }
];
// Explicit independent oracle for every state x command, including all organizer targets.
const matrix: Record<Exclude<RegistrationState['kind'], 'held'>, readonly string[]> = {
  none: [
    'confirmed',
    '!illegal_transition',
    '!not_withdrawable',
    '!illegal_transition',
    '!illegal_transition',
    '!illegal_transition',
    '!illegal_transition'
  ],
  applied: [
    '!duplicate',
    'applied',
    'cancelled',
    '!illegal_transition',
    'confirmed',
    'waitlisted',
    'cancelled'
  ],
  waitlisted: [
    '!duplicate',
    'waitlisted',
    'cancelled',
    'confirmed',
    'confirmed',
    '!illegal_transition',
    'cancelled'
  ],
  confirmed: [
    '!duplicate',
    'confirmed',
    'cancelled',
    '!illegal_transition',
    '!illegal_transition',
    'waitlisted',
    'cancelled'
  ],
  cancelled: [
    '!illegal_transition',
    '!illegal_transition',
    '!illegal_transition',
    '!illegal_transition',
    '!illegal_transition',
    '!illegal_transition',
    '!illegal_transition'
  ]
};
describe('pure registration lifecycle', () => {
  for (const [kind, outcomes] of Object.entries(matrix)) {
    commands.forEach((command, index) => {
      it(`${kind} x ${JSON.stringify(command)} = ${outcomes[index]}`, () => {
        const result = decide(
          { kind: kind as Exclude<RegistrationState['kind'], 'held'> },
          command,
          context
        );
        expect(result.ok ? result.next.kind : `!${result.code}`).toBe(outcomes[index]);
        if (result.ok) expect(result.effects).toContainEqual({ type: 'audit' });
      });
    });
  }
  it.each(['auto_confirm', 'approval'] as const)(
    'keeps %s capacity semantics separate from payment',
    (registrationMode) => {
      const result = decide(
        { kind: 'none' },
        { type: 'join' },
        { ...context, registrationMode, confirmedCount: 2 }
      );
      expect(result).toMatchObject({
        ok: true,
        next: { kind: registrationMode === 'approval' ? 'applied' : 'waitlisted' }
      });
    }
  );
  it('pins inclusive registration boundaries and exclusive participant cancellation boundary', () => {
    for (const now of [context.opensAt, context.closesAt])
      expect(decide({ kind: 'none' }, { type: 'join' }, { ...context, now }).ok).toBe(true);
    expect(
      decide({ kind: 'none' }, { type: 'join' }, { ...context, accepting: false })
    ).toMatchObject({ ok: false, code: 'not_registrable' });
    expect(
      decide({ kind: 'confirmed' }, { type: 'cancel' }, { ...context, now: context.startsAt })
    ).toMatchObject({ ok: false, code: 'not_withdrawable' });
    expect(
      decide({ kind: 'confirmed' }, { type: 'cancel' }, { ...context, accepting: false }).ok
    ).toBe(true);
  });
  it('accepts the additional window and uses the effective payment requirement after opening', () => {
    const betweenWindows = new Date('2027-01-01T06:00:00Z');
    const additionalOpensAt = new Date('2027-01-01T12:00:00Z');
    expect(
      decide(
        { kind: 'none' },
        { type: 'join' },
        { ...context, now: betweenWindows, closesAt: context.opensAt, additionalOpensAt }
      )
    ).toMatchObject({ ok: false, code: 'not_registrable' });
    expect(
      decide(
        { kind: 'none' },
        { type: 'join' },
        {
          ...context,
          now: additionalOpensAt,
          closesAt: context.opensAt,
          additionalOpensAt,
          paymentRequirement: 'pay_to_confirm'
        }
      )
    ).toMatchObject({ ok: true, next: { kind: 'held' } });
  });
  it.each([
    ['confirmed', 'unpaid', false, 'cancelled'],
    ['confirmed', 'paid', false, '!illegal_transition'],
    ['confirmed', 'waived', false, '!illegal_transition'],
    ['waitlisted', 'unpaid', false, '!illegal_transition'],
    ['confirmed', 'unpaid', true, '!checked_in']
  ] as const)(
    'paymentOverdue: %s + %s checkedIn=%s -> %s',
    (kind, payment, checkedIn, expected) => {
      const state = { kind } as RegistrationState;
      const paymentState =
        payment === 'paid'
          ? ({ kind: 'paid', recordId: 'record' } as const)
          : payment === 'waived'
            ? ({ kind: 'waived' } as const)
            : ({ kind: 'unpaid' } as const);
      const result = decide(
        state,
        { type: 'paymentOverdue' },
        {
          ...context,
          checkedIn,
          payment: paymentState
        }
      );
      expect(result.ok ? result.next.kind : `!${result.code}`).toBe(expected);
    }
  );

  it.each(['applied', 'waitlisted', 'confirmed'] as const)(
    'a checked-in %s attendance cannot be released, only confirmed',
    (kind) => {
      const checkedIn = { ...context, checkedIn: true };
      for (const command of [
        { type: 'cancel' },
        { type: 'setStatus', status: 'waitlisted' },
        { type: 'setStatus', status: 'cancelled' }
      ] as const) {
        const expected = command.type === 'setStatus' && command.status === kind;
        expect(decide({ kind }, command, checkedIn)).toMatchObject({
          ok: false,
          code: expected ? 'illegal_transition' : 'checked_in'
        });
      }
      // The check-in guard runs before the start-time boundary, so the reason is specific.
      expect(
        decide({ kind }, { type: 'cancel' }, { ...checkedIn, now: context.startsAt })
      ).toMatchObject({ ok: false, code: 'checked_in' });
    }
  );
  it('model-checks random actor command sequences against an independent transition matrix', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.constantFrom('auto_confirm', 'approval'),
        fc.array(
          fc.record({
            actor: fc.integer({ min: 0, max: 7 }),
            command: fc.integer({ min: 0, max: commands.length + 1 })
          }),
          { maxLength: 300 }
        ),
        (capacity, mode, sequence) => {
          const model: Exclude<RegistrationState['kind'], 'held'>[] = Array(8).fill('none');
          const actual: RegistrationState[] = model.map((kind) => ({ kind }));
          const checkedIn: boolean[] = Array(8).fill(false);
          for (const step of sequence) {
            const count = model.filter((kind) => kind === 'confirmed').length;
            const before = actual[step.actor];
            // Staff check-in admits only confirmed attendance; undo always clears the record.
            if (step.command >= commands.length) {
              checkedIn[step.actor] =
                step.command === commands.length && model[step.actor] === 'confirmed';
              continue;
            }
            const command = commands[step.command];
            let expected = matrix[model[step.actor]][step.command];
            if (
              checkedIn[step.actor] &&
              (command.type === 'cancel' ||
                (command.type === 'setStatus' &&
                  command.status !== 'confirmed' &&
                  expected !== '!illegal_transition'))
            )
              expected = '!checked_in';
            else if (model[step.actor] === 'none' && command.type === 'join')
              expected =
                mode === 'approval' ? 'applied' : count >= capacity ? 'waitlisted' : 'confirmed';
            else if (
              expected === 'confirmed' &&
              model[step.actor] !== 'confirmed' &&
              count >= capacity
            )
              expected = '!capacity';
            const result = decide(before, command, {
              ...context,
              capacity,
              confirmedCount: count,
              registrationMode: mode as 'auto_confirm' | 'approval',
              checkedIn: checkedIn[step.actor]
            });
            expect(result.ok ? result.next.kind : `!${result.code}`).toBe(expected);
            if (result.ok) {
              actual[step.actor] = result.next;
              if (result.next.kind === 'held') throw new Error('free admission unexpectedly held');
              model[step.actor] = result.next.kind;
            }
            if (before.kind === 'cancelled') expect(actual[step.actor]).toBe(before);
            expect(actual.filter((state) => state.kind === 'confirmed').length).toBeLessThanOrEqual(
              capacity
            );
            // Each actor has exactly one lifecycle; a rejected duplicate cannot create another.
            expect(actual.map((state) => state.kind)).toEqual(model);
            expect(actual).toHaveLength(8);
            expect(model.filter((kind, actor) => checkedIn[actor] && kind !== 'confirmed')).toEqual(
              []
            );
          }
        }
      ),
      { numRuns: 300 }
    );
  });
  it('model-checks time progression across payment opening and deadline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.array(
          fc.record({
            actor: fc.integer({ min: 0, max: 7 }),
            action: fc.constantFrom('join', 'open', 'pay', 'checkin', 'due')
          }),
          { minLength: 1, maxLength: 200 }
        ),
        (capacity, steps) => {
          const states: RegistrationState[] = Array.from({ length: 8 }, () => ({ kind: 'none' }));
          const paid = Array(8).fill(false) as boolean[];
          const checkedIn = Array(8).fill(false) as boolean[];
          let phase: 'before' | 'open' | 'due' = 'before';
          for (const step of steps) {
            if (step.action === 'open' && phase === 'before') phase = 'open';
            else if (step.action === 'due') {
              phase = 'due';
              for (let actor = 0; actor < states.length; actor++) {
                if (states[actor].kind !== 'confirmed' || paid[actor] || checkedIn[actor]) continue;
                const result = decide(
                  states[actor],
                  { type: 'paymentOverdue' },
                  {
                    ...context,
                    checkedIn: false,
                    payment: { kind: 'unpaid' }
                  }
                );
                if (!result.ok) throw new Error(result.code);
                states[actor] = result.next;
              }
            } else if (step.action === 'pay' && states[step.actor].kind !== 'none')
              paid[step.actor] = true;
            else if (step.action === 'checkin' && states[step.actor].kind === 'confirmed')
              checkedIn[step.actor] = true;
            else if (step.action === 'join' && states[step.actor].kind === 'none') {
              const occupied = states.filter((state) =>
                ['confirmed', 'held'].includes(state.kind)
              ).length;
              const result = decide(
                states[step.actor],
                { type: 'join' },
                {
                  ...context,
                  capacity,
                  confirmedCount: occupied,
                  paymentRequirement: phase === 'before' ? 'pay_later' : 'pay_to_confirm'
                }
              );
              if (result.ok) states[step.actor] = result.next;
            }
            const occupied = states.filter((state) =>
              ['confirmed', 'held'].includes(state.kind)
            ).length;
            expect(occupied).toBeLessThanOrEqual(capacity);
            expect(
              states.every((state, actor) => !checkedIn[actor] || state.kind === 'confirmed')
            ).toBe(true);
            if (phase === 'due')
              expect(
                states.every(
                  (state, actor) => state.kind !== 'confirmed' || paid[actor] || checkedIn[actor]
                )
              ).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
