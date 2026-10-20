import { read } from '$lib/server/db/client';
import { systemClock, type Clock } from '$lib/server/clock';
import { write } from '$lib/server/db/client';
import { and, asc, count, desc, eq, ne, or, sql } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import {
  auditLogs,
  events,
  externalAccounts,
  organizationMemberships,
  organizations,
  registrations,
  stripeConnectAccounts,
  users
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import {
  membershipStatusSchema,
  organizationRoleSchema,
  type MembershipStatus,
  type OrganizationRole
} from '$lib/shared/organization';
import { stripeOnboardingStatusSchema, type StripeOnboardingStatus } from '$lib/shared/payment';
import { PlatformError } from './errors';

export interface PlatformOrganizationRow {
  id: string;
  name: string;
  slug: string;
  suspendedAt: Date | null;
  eventCount: number;
  createdAt: Date;
}

export interface PlatformOrganizationMember {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  discordUserId: string;
  role: OrganizationRole;
  status: MembershipStatus;
}

export interface PlatformOrganizationEvent {
  id: string;
  title: string;
  activeRegistrationCount: number;
  archived: boolean;
}

export interface PlatformConnectStatus {
  onboardingStatus: StripeOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string;
  defaultCurrency: string;
}

export interface PlatformAuditDetail {
  id: string;
  action: string;
  actorName: string;
  eventTitle: string;
  reason: string;
  createdAt: Date;
}

export interface PlatformOrganizationDetail {
  organization: PlatformOrganizationRow;
  members: PlatformOrganizationMember[];
  events: PlatformOrganizationEvent[];
  connect: PlatformConnectStatus | null;
  recentAudits: PlatformAuditDetail[];
}

export interface PlatformUserRow {
  id: string;
  discordUserId: string;
  username: string;
  displayName: string;
  suspendedAt: Date | null;
  registrationCount: number;
  createdAt: Date;
}

export interface PlatformUserMembership {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  status: MembershipStatus;
}

export interface PlatformUserDetail {
  user: PlatformUserRow;
  memberships: PlatformUserMembership[];
  recentAudits: PlatformAuditDetail[];
}

export interface SetSuspensionInput {
  actorUserId: string;
  targetId: string;
  suspended: boolean;
  reason?: string;
}

const detailAuditLimit = 20;

const userSearchLimit = 50;

export async function listPlatformOrganizations(
  client: DatabaseClient
): Promise<PlatformOrganizationRow[]> {
  return read(client, (tx) => {
    const rows = tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        suspendedAt: organizations.suspendedAt,
        eventCount: count(events.id),
        createdAt: organizations.createdAt
      })
      .from(organizations)
      .leftJoin(events, eq(events.organizationId, organizations.id))
      .groupBy(organizations.id)
      .orderBy(asc(organizations.slug))
      .all();
    return rows;
  });
}

export async function getPlatformOrganization(
  client: DatabaseClient,
  organizationId: string
): Promise<PlatformOrganizationDetail> {
  return read(client, (tx) => {
    const organizationRows = tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        suspendedAt: organizations.suspendedAt,
        createdAt: organizations.createdAt
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .all();
    const organization = organizationRows[0];
    if (!organization) throw new PlatformError('not_found', 'organization not found');
    const [members, eventRows, connectRows, recentAudits] = [
      tx
        .select({
          id: organizationMemberships.id,
          userId: organizationMemberships.userId,
          displayName: externalAccounts.displayName,
          username: externalAccounts.username,
          discordUserId: externalAccounts.providerUserId,
          role: organizationMemberships.role,
          status: organizationMemberships.status
        })
        .from(organizationMemberships)
        .leftJoin(
          externalAccounts,
          and(
            eq(externalAccounts.userId, organizationMemberships.userId),
            eq(externalAccounts.provider, 'discord')
          )
        )
        .where(eq(organizationMemberships.organizationId, organizationId))
        .orderBy(organizationMemberships.id, externalAccounts.linkedAt)
        .all(),
      tx
        .select({
          id: events.id,
          title: events.title,
          activeRegistrationCount: count(registrations.id),
          archivedAt: events.archivedAt
        })
        .from(events)
        .leftJoin(
          registrations,
          and(eq(registrations.eventId, events.id), ne(registrations.status, 'cancelled'))
        )
        .where(eq(events.organizationId, organizationId))
        .groupBy(events.id)
        .orderBy(desc(events.startsAt), desc(events.id))
        .all(),
      tx
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.organizationId, organizationId))
        .limit(1)
        .all(),
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          actorDisplayName: externalAccounts.displayName,
          actorUsername: externalAccounts.username,
          eventTitle: events.title,
          reason: auditLogs.reason,
          createdAt: auditLogs.createdAt
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
        .leftJoin(externalAccounts, eq(externalAccounts.userId, auditLogs.actorUserId))
        .where(
          or(
            and(eq(auditLogs.targetType, 'organization'), eq(auditLogs.targetId, organizationId)),
            eq(events.organizationId, organizationId),
            eq(organizationMemberships.organizationId, organizationId)
          )
        )
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(detailAuditLimit)
        .all()
    ];
    const connect = connectRows[0];
    return {
      organization: { ...organization, eventCount: eventRows.length },
      members: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        displayName: member.displayName || member.username || '',
        username: member.username ?? '',
        discordUserId: member.discordUserId ?? '',
        role: organizationRoleSchema.parse(member.role),
        status: membershipStatusSchema.parse(member.status)
      })),
      events: eventRows.map((event) => ({
        id: event.id,
        title: event.title,
        activeRegistrationCount: event.activeRegistrationCount,
        archived: event.archivedAt !== null
      })),
      connect: connect
        ? {
            onboardingStatus: stripeOnboardingStatusSchema.parse(connect.onboardingStatus),
            chargesEnabled: connect.chargesEnabled,
            payoutsEnabled: connect.payoutsEnabled,
            detailsSubmitted: connect.detailsSubmitted,
            country: connect.country,
            defaultCurrency: connect.defaultCurrency
          }
        : null,
      recentAudits: mapAuditRows(recentAudits)
    };
  });
}

export async function searchPlatformUsers(
  client: DatabaseClient,
  query: string
): Promise<PlatformUserRow[]> {
  return read(client, (tx) => {
    const normalized = query.trim();
    if (!normalized) return [];
    const rows = tx
      .select({
        id: users.id,
        discordUserId: externalAccounts.providerUserId,
        username: externalAccounts.username,
        displayName: externalAccounts.displayName,
        suspendedAt: users.suspendedAt,
        registrationCount: count(registrations.id),
        createdAt: users.createdAt
      })
      .from(users)
      .innerJoin(
        externalAccounts,
        and(eq(externalAccounts.userId, users.id), eq(externalAccounts.provider, 'discord'))
      )
      .leftJoin(registrations, eq(registrations.userId, users.id))
      .where(
        or(
          eq(externalAccounts.providerUserId, normalized),
          sql`instr(offkai_lower(${externalAccounts.displayName}), offkai_lower(${normalized})) > 0`,
          sql`instr(offkai_lower(${externalAccounts.username}), offkai_lower(${normalized})) > 0`
        )
      )
      .groupBy(users.id, externalAccounts.id)
      .orderBy(asc(externalAccounts.displayName), asc(users.id))
      .limit(userSearchLimit)
      .all();
    return rows;
  });
}

export async function getPlatformUser(
  client: DatabaseClient,
  userId: string
): Promise<PlatformUserDetail> {
  return read(client, (tx) => {
    const userRows = tx
      .select({
        id: users.id,
        discordUserId: externalAccounts.providerUserId,
        username: externalAccounts.username,
        displayName: externalAccounts.displayName,
        suspendedAt: users.suspendedAt,
        registrationCount: count(registrations.id),
        createdAt: users.createdAt
      })
      .from(users)
      .leftJoin(
        externalAccounts,
        and(eq(externalAccounts.userId, users.id), eq(externalAccounts.provider, 'discord'))
      )
      .leftJoin(registrations, eq(registrations.userId, users.id))
      .where(eq(users.id, userId))
      .groupBy(users.id, externalAccounts.id)
      .limit(1)
      .all();
    const user = userRows[0];
    if (!user) throw new PlatformError('not_found', 'user not found');
    const [memberships, recentAudits] = [
      tx
        .select({
          organizationId: organizations.id,
          organizationName: organizations.name,
          role: organizationMemberships.role,
          status: organizationMemberships.status
        })
        .from(organizationMemberships)
        .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
        .where(eq(organizationMemberships.userId, userId))
        .orderBy(asc(organizations.name))
        .all(),
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          actorDisplayName: externalAccounts.displayName,
          actorUsername: externalAccounts.username,
          eventTitle: events.title,
          reason: auditLogs.reason,
          createdAt: auditLogs.createdAt
        })
        .from(auditLogs)
        .leftJoin(events, eq(events.id, auditLogs.eventId))
        .leftJoin(externalAccounts, eq(externalAccounts.userId, auditLogs.actorUserId))
        .where(
          or(
            eq(auditLogs.actorUserId, userId),
            and(eq(auditLogs.targetType, 'user'), eq(auditLogs.targetId, userId))
          )
        )
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(detailAuditLimit)
        .all()
    ];
    return {
      user: {
        ...user,
        discordUserId: user.discordUserId ?? '',
        username: user.username ?? '',
        displayName: user.displayName || user.username || ''
      },
      memberships: memberships.map((membership) => ({
        ...membership,
        role: organizationRoleSchema.parse(membership.role),
        status: membershipStatusSchema.parse(membership.status)
      })),
      recentAudits: mapAuditRows(recentAudits)
    };
  });
}

export async function setOrganizationSuspension(
  client: DatabaseClient,
  input: SetSuspensionInput,
  clock: Clock = systemClock
): Promise<void> {
  const reason = validateSuspensionReason(input.suspended, input.reason);
  write(client, (tx) => {
    const rows = tx
      .select({ suspendedAt: organizations.suspendedAt })
      .from(organizations)
      .where(eq(organizations.id, input.targetId))
      .limit(1)
      .all();
    const current = rows[0];
    if (!current) throw new PlatformError('not_found', 'organization not found');
    if ((current.suspendedAt !== null) === input.suspended) return;
    tx.update(organizations)
      .set({ suspendedAt: input.suspended ? clock.now() : null, updatedAt: clock.now() })
      .where(eq(organizations.id, input.targetId))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        action: input.suspended ? 'platform.org_suspend' : 'platform.org_unsuspend',
        targetType: 'organization',
        targetId: input.targetId,
        reason,
        before: { suspended: current.suspendedAt !== null },
        after: { suspended: input.suspended }
      },
      clock
    );
  });
}

export async function setUserSuspension(
  client: DatabaseClient,
  input: SetSuspensionInput,
  clock: Clock = systemClock
): Promise<void> {
  if (input.suspended && input.actorUserId === input.targetId) {
    throw new PlatformError('self_suspend', 'platform administrators cannot suspend themselves');
  }
  const reason = validateSuspensionReason(input.suspended, input.reason);
  write(client, (tx) => {
    const rows = tx
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, input.targetId))
      .limit(1)
      .all();
    const current = rows[0];
    if (!current) throw new PlatformError('not_found', 'user not found');
    if ((current.suspendedAt !== null) === input.suspended) return;
    tx.update(users)
      .set({ suspendedAt: input.suspended ? clock.now() : null, updatedAt: clock.now() })
      .where(eq(users.id, input.targetId))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        action: input.suspended ? 'platform.user_suspend' : 'platform.user_unsuspend',
        targetType: 'user',
        targetId: input.targetId,
        reason,
        before: { suspended: current.suspendedAt !== null },
        after: { suspended: input.suspended }
      },
      clock
    );
  });
}

function validateSuspensionReason(suspended: boolean, input: string | undefined): string {
  const reason = input?.trim() ?? '';
  if (suspended && !reason) {
    throw new PlatformError('validation', 'a suspension reason is required');
  }
  return reason;
}

function mapAuditRows(
  rows: {
    id: string;
    action: string;
    actorDisplayName: string | null;
    actorUsername: string | null;
    eventTitle: string | null;
    reason: string;
    createdAt: Date;
  }[]
): PlatformAuditDetail[] {
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorName: row.actorDisplayName || row.actorUsername || '',
    eventTitle: row.eventTitle ?? '',
    reason: row.reason,
    createdAt: row.createdAt
  }));
}
