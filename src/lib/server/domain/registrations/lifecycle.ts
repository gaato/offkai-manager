import { and, count, eq, inArray } from 'drizzle-orm';
import type { Clock } from '$lib/server/clock';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { events, registrations } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { enqueuePanelRefresh, enqueueRoleSync } from '$lib/server/domain/discord/outbox';
import { paymentRequirementSchema } from '$lib/shared/payment';
import { registrationModeSchema } from '$lib/shared/event';
import { decide, type RegistrationCommand, type RegistrationState } from './core';
import { RegistrationError } from './errors';

export function decideRegistration(
  tx: DatabaseTransaction,
  event: typeof events.$inferSelect,
  state: RegistrationState,
  command: RegistrationCommand,
  clock: Clock
) {
  const confirmedCount = tx
    .select({ n: count() })
    .from(registrations)
    .where(
      and(eq(registrations.eventId, event.id), inArray(registrations.status, ['confirmed', 'held']))
    )
    .get()!.n;
  const result = decide(state, command, {
    now: clock.now(),
    opensAt: event.registrationOpensAt,
    closesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    accepting: !event.cancelledAt && !event.archivedAt && event.visibility !== 'draft',
    capacity: event.capacity,
    confirmedCount,
    paymentRequirement: paymentRequirementSchema.parse(event.paymentRequirement),
    holdMinutes: event.holdMinutes,
    registrationMode: registrationModeSchema.parse(event.registrationMode)
  });
  if (!result.ok) throw new RegistrationError(result.code, 'registration transition rejected');
  return result;
}

/** Effects execute in the same write transaction as the state and answer changes. */
export function applyRegistrationEffects(
  tx: DatabaseTransaction,
  decision: Extract<ReturnType<typeof decide>, { ok: true }>,
  audit: Parameters<typeof appendAudit>[1] & { eventId: string; targetId: string },
  clock: Clock
): void {
  for (const effect of decision.effects) {
    switch (effect.type) {
      case 'audit':
        appendAudit(tx, audit, clock);
        break;
      case 'syncRoles':
        enqueueRoleSync(tx, audit.eventId, audit.targetId, clock);
        break;
      case 'refreshPanels':
        enqueuePanelRefresh(tx, audit.eventId, clock);
        break;
      default:
        effect satisfies never;
    }
  }
}
