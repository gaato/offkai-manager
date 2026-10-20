import { systemClock, type Clock } from '$lib/server/clock';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { auditLogs } from '$lib/server/db/schema';

export interface AuditEntry {
  actorUserId: string | null;
  eventId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: unknown;
}

export function appendAudit(
  tx: DatabaseTransaction,
  entry: AuditEntry,
  clock: Clock = systemClock
): void {
  tx.insert(auditLogs)
    .values({
      createdAt: clock.now(),
      actorUserId: entry.actorUserId,
      eventId: entry.eventId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      beforeJson: entry.before,
      afterJson: entry.after,
      reason: entry.reason ?? '',
      metadataJson: entry.metadata
    })
    .run();
}
