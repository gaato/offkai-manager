import { defaultTuning, type Tuning } from '$lib/server/config';
import { read } from '$lib/server/db/client';
import { count, desc, eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { auditLogs, events, externalAccounts, organizations, users } from '$lib/server/db/schema';

export interface PlatformAuditRow {
  id: string;
  action: string;
  actorName: string;
  eventTitle: string;
  targetType: string;
  reason: string;
  createdAt: Date;
}

export interface PlatformDashboard {
  organizationCount: number;
  userCount: number;
  eventCount: number;
  recentAudits: PlatformAuditRow[];
}

export async function getPlatformDashboard(
  client: DatabaseClient,
  tuning: Tuning = defaultTuning
): Promise<PlatformDashboard> {
  return read(client, (tx) => {
    const [organizationRows, userRows, eventRows, recentAudits] = [
      tx.select({ value: count() }).from(organizations).all(),
      tx.select({ value: count() }).from(users).all(),
      tx.select({ value: count() }).from(events).all(),
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          actorDisplayName: externalAccounts.displayName,
          actorUsername: externalAccounts.username,
          eventTitle: events.title,
          targetType: auditLogs.targetType,
          reason: auditLogs.reason,
          createdAt: auditLogs.createdAt
        })
        .from(auditLogs)
        .leftJoin(externalAccounts, eq(externalAccounts.userId, auditLogs.actorUserId))
        .leftJoin(events, eq(events.id, auditLogs.eventId))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(tuning.OFFKAI_PLATFORM_RECENT_AUDIT_LIMIT)
        .all()
    ];
    return {
      organizationCount: organizationRows[0]?.value ?? 0,
      userCount: userRows[0]?.value ?? 0,
      eventCount: eventRows[0]?.value ?? 0,
      recentAudits: recentAudits.map((row) => ({
        id: row.id,
        action: row.action,
        actorName: row.actorDisplayName || row.actorUsername || '',
        eventTitle: row.eventTitle ?? '',
        targetType: row.targetType,
        reason: row.reason,
        createdAt: row.createdAt
      }))
    };
  });
}
