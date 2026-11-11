import { describe, expect, it } from 'vitest';
import {
  isLoosening,
  overduePolicyColumns,
  overduePolicyFromColumns,
  overdueReleasableAt,
  type OverduePolicy
} from '$lib/shared/overdue-policy';

const auto = (graceDays: number): OverduePolicy => ({ kind: 'auto', graceDays });
const manual = (graceDays: number): OverduePolicy => ({ kind: 'manual', graceDays });
const due = new Date('2027-02-01T15:00:00Z');
const earlier = new Date('2027-01-30T15:00:00Z');
const later = new Date('2027-02-03T15:00:00Z');

describe('overdue policy', () => {
  it('becomes releasable after the grace period for both kinds', () => {
    expect(overdueReleasableAt(due, auto(0))).toEqual(due);
    expect(overdueReleasableAt(due, auto(3))).toEqual(new Date('2027-02-04T15:00:00Z'));
    expect(overdueReleasableAt(due, manual(7))).toEqual(new Date('2027-02-08T15:00:00Z'));
  });

  it.each([
    [due, auto(0), due, auto(0), true],
    [due, auto(0), due, auto(3), true],
    [due, auto(3), due, auto(2), false],
    // Switching to organizer judgement keeps the announced grace period.
    [due, auto(7), due, manual(7), true],
    [due, auto(7), due, manual(0), false],
    [due, manual(0), due, manual(3), true],
    [due, manual(30), due, auto(30), false],
    // Moving the deadline is judged by the moment it makes seats releasable.
    [due, auto(3), earlier, auto(3), false],
    [due, auto(3), earlier, auto(5), true],
    [due, manual(0), later, manual(0), true]
  ])('%s %o → %s %o is loosening: %s', (currentDue, current, nextDue, next, expected) => {
    expect(
      isLoosening({ dueAt: currentDue, policy: current }, { dueAt: nextDue, policy: next })
    ).toBe(expected);
  });

  it('round-trips through storage columns', () => {
    for (const policy of [auto(0), auto(7), manual(0), manual(5)])
      expect(overduePolicyFromColumns(overduePolicyColumns(policy))).toEqual(policy);
    expect(() =>
      overduePolicyFromColumns({ overdueRelease: 'later', overdueGraceDays: 0 })
    ).toThrow();
  });
});
