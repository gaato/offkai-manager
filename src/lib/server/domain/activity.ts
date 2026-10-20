import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  auditLogs,
  events,
  externalAccounts,
  organizationMemberships
} from '$lib/server/db/schema';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';

const activityLimit = 100;

export interface ActivityRow {
  id: string;
  action: string;
  actorName: string;
  eventTitle: string;
  reason: string;
  createdAt: Date;
}

export async function listEventActivity(
  client: DatabaseClient,
  actorUserId: string,
  eventId: string
): Promise<ActivityRow[]> {
  return client.db.transaction(async (tx) => {
    const eventRows = await tx
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    if (!eventRows[0]) return [];
    await authorizeOrganizationRole(
      tx,
      eventRows[0].organizationId,
      actorUserId,
      'staff',
      false,
      true
    );
    const rows = await tx
      .select({ audit: auditLogs })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, eventId))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(activityLimit);
    return addActorNames(
      tx,
      rows.map(({ audit }) => ({ ...audit, eventTitle: '' }))
    );
  });
}

export async function listOrganizationActivity(
  client: DatabaseClient,
  actorUserId: string,
  organizationId: string
): Promise<ActivityRow[]> {
  return client.db.transaction(async (tx) => {
    await authorizeOrganizationRole(tx, organizationId, actorUserId, 'staff', false, true);
    const rows = await tx
      .select({
        audit: auditLogs,
        eventTitle: events.title
      })
      .from(auditLogs)
      .leftJoin(events, eq(events.id, auditLogs.eventId))
      .leftJoin(
        organizationMemberships,
        and(
          eq(auditLogs.targetType, 'organization_membership'),
          eq(auditLogs.targetId, organizationMemberships.id)
        )
      )
      .where(
        or(
          and(eq(auditLogs.targetType, 'organization'), eq(auditLogs.targetId, organizationId)),
          eq(events.organizationId, organizationId),
          eq(organizationMemberships.organizationId, organizationId)
        )
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(activityLimit);
    return addActorNames(
      tx,
      rows.map(({ audit, eventTitle }) => ({ ...audit, eventTitle: eventTitle ?? '' }))
    );
  });
}

async function addActorNames(
  tx: DatabaseTransaction,
  rows: (typeof auditLogs.$inferSelect & { eventTitle: string })[]
): Promise<ActivityRow[]> {
  const actorIds = [...new Set(rows.map(({ actorUserId }) => actorUserId).filter(isString))];
  const actors =
    actorIds.length === 0
      ? []
      : await tx
          .select({
            userId: externalAccounts.userId,
            displayName: externalAccounts.displayName,
            username: externalAccounts.username
          })
          .from(externalAccounts)
          .where(
            and(
              eq(externalAccounts.provider, 'discord'),
              inArray(externalAccounts.userId, actorIds)
            )
          );
  const actorNames = new Map(
    actors.map(({ userId, displayName, username }) => [userId, displayName || username])
  );
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorName: row.actorUserId ? (actorNames.get(row.actorUserId) ?? '') : '',
    eventTitle: row.eventTitle,
    reason: row.reason,
    createdAt: row.createdAt
  }));
}

function isString(value: string | null): value is string {
  return value !== null;
}
