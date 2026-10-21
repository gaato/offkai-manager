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
const matrix: Record<RegistrationState['kind'], readonly string[]> = {
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
        const result = decide({ kind: kind as RegistrationState['kind'] }, command, context);
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

  it('model-checks random actor command sequences against an independent transition matrix', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.constantFrom('auto_confirm', 'approval'),
        fc.array(
          fc.record({
            actor: fc.integer({ min: 0, max: 7 }),
            command: fc.integer({ min: 0, max: commands.length - 1 })
          }),
          { maxLength: 300 }
        ),
        (capacity, mode, sequence) => {
          const model: RegistrationState['kind'][] = Array(8).fill('none');
          const actual: RegistrationState[] = model.map((kind) => ({ kind }));
          for (const step of sequence) {
            const count = model.filter((kind) => kind === 'confirmed').length;
            const before = actual[step.actor];
            const command = commands[step.command];
            let expected = matrix[model[step.actor]][step.command];
            if (model[step.actor] === 'none' && command.type === 'join')
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
              registrationMode: mode as 'auto_confirm' | 'approval'
            });
            expect(result.ok ? result.next.kind : `!${result.code}`).toBe(expected);
            if (result.ok) {
              actual[step.actor] = result.next;
              model[step.actor] = result.next.kind;
            }
            if (before.kind === 'cancelled') expect(actual[step.actor]).toBe(before);
            expect(actual.filter((state) => state.kind === 'confirmed').length).toBeLessThanOrEqual(
              capacity
            );
            // Each actor has exactly one lifecycle; a rejected duplicate cannot create another.
            expect(actual.map((state) => state.kind)).toEqual(model);
            expect(actual).toHaveLength(8);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});
