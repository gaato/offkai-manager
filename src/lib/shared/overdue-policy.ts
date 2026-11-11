import { z } from 'zod';

export const overdueReleases = ['auto', 'manual'] as const;
export const overdueReleaseSchema = z.enum(overdueReleases);
export type OverdueRelease = z.infer<typeof overdueReleaseSchema>;

/**
 * What happens to a confirmed, unpaid attendance once the scheduled payment deadline passes,
 * as two independent answers: from when the seat may be given up (`graceDays` after the
 * deadline), and who gives it up (`auto`: the worker at that moment; `manual`: organizers, at
 * that moment or later). Nobody is released before the deadline plus the grace period.
 */
export interface OverduePolicy {
  readonly kind: OverdueRelease;
  readonly graceDays: number;
}

export const OVERDUE_GRACE_DAYS_MAX = 30;
export const defaultOverduePolicy: OverduePolicy = { kind: 'auto', graceDays: 0 };

const dayMs = 24 * 60 * 60 * 1000;

export function overduePolicyFromColumns(row: {
  overdueRelease: string;
  overdueGraceDays: number;
}): OverduePolicy {
  return { kind: overdueReleaseSchema.parse(row.overdueRelease), graceDays: row.overdueGraceDays };
}

export function overduePolicyColumns(policy: OverduePolicy): {
  overdueRelease: OverdueRelease;
  overdueGraceDays: number;
} {
  return { overdueRelease: policy.kind, overdueGraceDays: policy.graceDays };
}

/** The earliest moment any unpaid seat may be released, by the worker or by organizers. */
export function overdueReleasableAt(dueAt: Date, policy: OverduePolicy): Date {
  return new Date(dueAt.getTime() + policy.graceDays * dayMs);
}

/**
 * True when a change keeps every participant at least as safe as the announced rule: the
 * earliest release moment does not move earlier, and organizer judgement does not turn into an
 * automatic release. Callers pass the deadlines too, because moving the deadline earlier
 * tightens the rule exactly like shortening the grace period.
 */
export function isLoosening(
  current: { dueAt: Date; policy: OverduePolicy },
  next: { dueAt: Date; policy: OverduePolicy }
): boolean {
  if (current.policy.kind === 'manual' && next.policy.kind === 'auto') return false;
  return (
    overdueReleasableAt(next.dueAt, next.policy) >=
    overdueReleasableAt(current.dueAt, current.policy)
  );
}
