import { read } from '$lib/server/db/client';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { auditLogs, events, externalAccounts } from '$lib/server/db/schema';
import { listUnresolvedSettleConflicts } from '$lib/server/domain/payments';

export interface PlatformActivityQuery {
  actionPrefix: string;
  targetId: string;
  page: number;
}

export interface PlatformActivityRow {
  id: string;
  action: string;
  actorName: string;
  eventTitle: string;
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: Date;
}

export interface PlatformActivityPage {
  rows: PlatformActivityRow[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

const activityPageSize = 50;

export async function searchPlatformActivity(
  client: DatabaseClient,
  input: PlatformActivityQuery
): Promise<PlatformActivityPage> {
  return read(client, (tx) => {
    const page = Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1;
    const actionPrefix = input.actionPrefix.trim().slice(0, 200);
    const targetId = input.targetId.trim().slice(0, 200);
    const conditions: SQL[] = [];
    if (actionPrefix) {
      conditions.push(
        sql`substr(${auditLogs.action}, 1, length(${actionPrefix})) = ${actionPrefix}`
      );
    }
    if (targetId) {
      conditions.push(sql`${auditLogs.targetId} = ${targetId}`);
    }
    const rows = tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorDisplayName: externalAccounts.displayName,
        actorUsername: externalAccounts.username,
        eventTitle: events.title,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        reason: auditLogs.reason,
        createdAt: auditLogs.createdAt
      })
      .from(auditLogs)
      .leftJoin(
        externalAccounts,
        and(
          eq(externalAccounts.userId, auditLogs.actorUserId),
          eq(externalAccounts.provider, 'discord')
        )
      )
      .leftJoin(events, eq(events.id, auditLogs.eventId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(activityPageSize + 1)
      .offset((page - 1) * activityPageSize)
      .all();
    const hasNext = rows.length > activityPageSize;
    return {
      rows: rows.slice(0, activityPageSize).map((row) => ({
        id: row.id,
        action: row.action,
        actorName: row.actorDisplayName || row.actorUsername || '',
        eventTitle: row.eventTitle ?? '',
        targetType: row.targetType,
        targetId: row.targetId ?? '',
        reason: row.reason,
        createdAt: row.createdAt
      })),
      page,
      hasPrevious: page > 1,
      hasNext
    };
  });
}

export async function listPlatformPaymentConflicts(client: DatabaseClient) {
  return read(client, (tx) => listUnresolvedSettleConflicts(tx, { newestFirst: true }));
}
