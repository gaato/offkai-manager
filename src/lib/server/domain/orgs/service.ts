import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  externalAccounts,
  organizationMemberships,
  organizations,
  users
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import {
  invitableOrganizationRoleSchema,
  membershipStatusSchema,
  organizationRoleSchema,
  type MembershipStatus,
  type OrganizationRole
} from '$lib/shared/organization';
import { authorizeOrganizationRole } from './authorization';
import { OrganizationError } from './errors';
import { availableOrganizationSlug } from './slug';
import type {
  ChangeMembershipStatusInput,
  ChangeRoleInput,
  CreateOrganizationInput,
  InviteMemberInput,
  OrganizationMember,
  OrganizationSummary
} from './types';

const discordSnowflakePattern = /^\d{17,20}$/;

export async function createOrganization(
  client: DatabaseClient,
  input: CreateOrganizationInput,
  clock: Clock = systemClock
): Promise<OrganizationSummary> {
  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new OrganizationError('validation', 'organization name must be 1 to 120 characters');
  }
  return write(client, (tx) => {
    const actor = tx
      .select({ id: users.id, suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, input.actorUserId))
      .limit(1)
      .all();
    if (!actor[0]) throw new OrganizationError('not_found', 'actor user not found');
    if (actor[0].suspendedAt) throw new OrganizationError('forbidden', 'actor user is suspended');
    // BEGIN IMMEDIATE serializes slug selection, including collisions between
    // one name's suffix and another name's base.
    const slugRows = tx.select({ slug: organizations.slug }).from(organizations).all();
    const slug = availableOrganizationSlug(name, new Set(slugRows.map((row) => row.slug)));
    const created = tx
      .insert(organizations)
      .values({ createdAt: clock.now(), updatedAt: clock.now(), name, slug })
      .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug })
      .all();
    const organization = created[0];
    tx.insert(organizationMemberships)
      .values({
        createdAt: clock.now(),
        updatedAt: clock.now(),
        joinedAt: clock.now(),
        organizationId: organization.id,
        userId: input.actorUserId,
        role: 'owner',
        status: 'active'
      })
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        action: 'organization.create',
        targetType: 'organization',
        targetId: organization.id,
        after: { name: organization.name, slug: organization.slug }
      },
      clock
    );
    return { ...organization, actorRole: 'owner', suspendedAt: null };
  });
}

export async function listOrganizationsForUser(
  client: DatabaseClient,
  userId: string
): Promise<OrganizationSummary[]> {
  return read(client, (tx) => {
    const rows = tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        suspendedAt: organizations.suspendedAt,
        actorRole: organizationMemberships.role
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active'),
          sql`${organizations.suspendedAt} is null`
        )
      )
      .orderBy(asc(organizations.createdAt))
      .all();
    return rows.map((row) => ({ ...row, actorRole: parseRole(row.actorRole) }));
  });
}

export async function getOrganizationForUser(
  client: DatabaseClient,
  actorUserId: string,
  organizationId: string
): Promise<OrganizationSummary> {
  return read(client, (tx) => {
    const authorized = authorizeOrganizationRole(tx, organizationId, actorUserId, 'viewer', true);
    return {
      id: authorized.id,
      name: authorized.name,
      slug: authorized.slug,
      actorRole: authorized.role,
      suspendedAt: authorized.suspendedAt
    };
  });
}

export async function listOrganizationMembers(
  client: DatabaseClient,
  actorUserId: string,
  organizationId: string
): Promise<OrganizationMember[]> {
  return read(client, (tx) => {
    authorizeOrganizationRole(tx, organizationId, actorUserId, 'viewer', true);
    const rows = tx
      .select({
        id: organizationMemberships.id,
        organizationId: organizationMemberships.organizationId,
        userId: organizationMemberships.userId,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
        discordUserId: externalAccounts.providerUserId,
        username: externalAccounts.username,
        displayName: externalAccounts.displayName,
        avatarUrl: externalAccounts.avatarUrl
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
      .all();
    return rows.map((row) => ({
      ...row,
      role: parseRole(row.role),
      status: parseStatus(row.status),
      discordUserId: row.discordUserId ?? '',
      username: row.username ?? '',
      displayName: row.displayName || row.username || '',
      avatarUrl: row.avatarUrl ?? ''
    }));
  });
}

export async function inviteMember(
  client: DatabaseClient,
  input: InviteMemberInput,
  clock: Clock = systemClock
): Promise<OrganizationMember> {
  if (!discordSnowflakePattern.test(input.discordUserId)) {
    throw new OrganizationError('validation', 'invalid Discord user ID');
  }
  if (!invitableOrganizationRoleSchema.safeParse(input.role).success) {
    throw new OrganizationError('validation', 'invalid invited role');
  }
  return write(client, (tx) => {
    authorizeOrganizationRole(tx, input.organizationId, input.actorUserId, 'owner');
    const accounts = tx
      .select({
        userId: externalAccounts.userId,
        suspendedAt: users.suspendedAt
      })
      .from(externalAccounts)
      .innerJoin(users, eq(users.id, externalAccounts.userId))
      .where(
        and(
          eq(externalAccounts.provider, 'discord'),
          eq(externalAccounts.providerUserId, input.discordUserId)
        )
      )
      .limit(1)
      .all();
    const account = accounts[0];
    if (!account) throw new OrganizationError('not_found', 'Discord account not found');
    if (account.suspendedAt) throw new OrganizationError('forbidden', 'invited user is suspended');
    const currentRows = tx
      .select({
        id: organizationMemberships.id,
        role: organizationMemberships.role,
        status: organizationMemberships.status
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, input.organizationId),
          eq(organizationMemberships.userId, account.userId)
        )
      )
      .limit(1)
      .all();
    const current = currentRows[0];
    if (current?.status === 'active') {
      throw new OrganizationError('conflict', 'user is already an active member');
    }
    let membershipId: string;
    if (current) {
      membershipId = current.id;
      tx.update(organizationMemberships)
        .set({
          role: input.role,
          status: 'active',
          joinedAt: clock.now(),
          invitedByUserId: input.actorUserId,
          updatedAt: clock.now()
        })
        .where(eq(organizationMemberships.id, current.id))
        .run();
    } else {
      const inserted = tx
        .insert(organizationMemberships)
        .values({
          createdAt: clock.now(),
          updatedAt: clock.now(),
          joinedAt: clock.now(),
          organizationId: input.organizationId,
          userId: account.userId,
          role: input.role,
          status: 'active',
          invitedByUserId: input.actorUserId
        })
        .returning({ id: organizationMemberships.id })
        .all();
      membershipId = inserted[0].id;
    }
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        action: 'membership.invite',
        targetType: 'organization_membership',
        targetId: membershipId,
        before: current ? { role: current.role, status: current.status } : undefined,
        after: { role: input.role, status: 'active' }
      },
      clock
    );
    return loadMember(tx, membershipId);
  });
}

export async function changeRole(
  client: DatabaseClient,
  input: ChangeRoleInput,
  clock: Clock = systemClock
): Promise<OrganizationMember> {
  if (!organizationRoleSchema.safeParse(input.role).success) {
    throw new OrganizationError('validation', 'invalid organization role');
  }
  return write(client, (tx) => {
    const organizationId = membershipOrganizationId(tx, input.membershipId);
    authorizeOrganizationRole(tx, organizationId, input.actorUserId, 'owner');
    const member = lockedMember(tx, input.membershipId);
    if (member.status !== 'active') {
      throw new OrganizationError('conflict', 'membership is not active');
    }
    if (member.role === input.role) return loadMember(tx, input.membershipId);
    if (member.role === 'owner' && input.role !== 'owner') {
      assertAnotherActiveOwner(tx, organizationId);
    }
    tx.update(organizationMemberships)
      .set({ role: input.role, updatedAt: clock.now() })
      .where(eq(organizationMemberships.id, input.membershipId))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        action: 'membership.role_change',
        targetType: 'organization_membership',
        targetId: input.membershipId,
        reason: input.reason?.trim(),
        before: { role: member.role },
        after: { role: input.role }
      },
      clock
    );
    return loadMember(tx, input.membershipId);
  });
}

export async function disableMembership(
  client: DatabaseClient,
  input: ChangeMembershipStatusInput,
  clock: Clock = systemClock
): Promise<OrganizationMember> {
  return changeMembershipStatus(client, input, 'disabled', clock);
}

export async function enableMembership(
  client: DatabaseClient,
  input: ChangeMembershipStatusInput,
  clock: Clock = systemClock
): Promise<OrganizationMember> {
  return changeMembershipStatus(client, input, 'active', clock);
}

async function changeMembershipStatus(
  client: DatabaseClient,
  input: ChangeMembershipStatusInput,
  status: MembershipStatus,
  clock: Clock = systemClock
): Promise<OrganizationMember> {
  return write(client, (tx) => {
    const organizationId = membershipOrganizationId(tx, input.membershipId);
    authorizeOrganizationRole(tx, organizationId, input.actorUserId, 'owner');
    const member = lockedMember(tx, input.membershipId);
    if (member.status === status) return loadMember(tx, input.membershipId);
    if (member.role === 'owner' && member.status === 'active' && status === 'disabled') {
      assertAnotherActiveOwner(tx, organizationId);
    }
    tx.update(organizationMemberships)
      .set({ status, updatedAt: clock.now() })
      .where(eq(organizationMemberships.id, input.membershipId))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        action: status === 'active' ? 'membership.enable' : 'membership.disable',
        targetType: 'organization_membership',
        targetId: input.membershipId,
        reason: input.reason?.trim(),
        before: { status: member.status },
        after: { status }
      },
      clock
    );
    return loadMember(tx, input.membershipId);
  });
}

function membershipOrganizationId(tx: DatabaseTransaction, membershipId: string): string {
  const rows = tx
    .select({ organizationId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.id, membershipId))
    .limit(1)
    .all();
  if (!rows[0]) throw new OrganizationError('not_found', 'membership not found');
  return rows[0].organizationId;
}

function lockedMember(tx: DatabaseTransaction, membershipId: string) {
  const rows = tx
    .select({
      id: organizationMemberships.id,
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.role,
      status: organizationMemberships.status
    })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.id, membershipId))
    .limit(1)
    .all();
  if (!rows[0]) throw new OrganizationError('not_found', 'membership not found');
  return {
    ...rows[0],
    role: parseRole(rows[0].role),
    status: parseStatus(rows[0].status)
  };
}

function assertAnotherActiveOwner(tx: DatabaseTransaction, organizationId: string): void {
  const rows = tx
    .select({ count: sql<number>`count(*)` })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, 'owner'),
        eq(organizationMemberships.status, 'active')
      )
    )
    .all();
  if ((rows[0]?.count ?? 0) <= 1) {
    throw new OrganizationError('last_owner', 'organization must keep an active owner');
  }
}

function loadMember(tx: DatabaseTransaction, membershipId: string): OrganizationMember {
  const rows = tx
    .select({
      id: organizationMemberships.id,
      organizationId: organizationMemberships.organizationId,
      userId: organizationMemberships.userId,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
      discordUserId: externalAccounts.providerUserId,
      username: externalAccounts.username,
      displayName: externalAccounts.displayName,
      avatarUrl: externalAccounts.avatarUrl
    })
    .from(organizationMemberships)
    .leftJoin(
      externalAccounts,
      and(
        eq(externalAccounts.userId, organizationMemberships.userId),
        eq(externalAccounts.provider, 'discord')
      )
    )
    .where(eq(organizationMemberships.id, membershipId))
    .orderBy(asc(externalAccounts.linkedAt))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) throw new OrganizationError('not_found', 'membership not found');
  return {
    ...row,
    role: parseRole(row.role),
    status: parseStatus(row.status),
    discordUserId: row.discordUserId ?? '',
    username: row.username ?? '',
    displayName: row.displayName || row.username || '',
    avatarUrl: row.avatarUrl ?? ''
  };
}

function parseRole(value: string): OrganizationRole {
  const parsed = organizationRoleSchema.safeParse(value);
  if (!parsed.success) throw new OrganizationError('validation', 'invalid stored role');
  return parsed.data;
}

function parseStatus(value: string): MembershipStatus {
  const parsed = membershipStatusSchema.safeParse(value);
  if (!parsed.success)
    throw new OrganizationError('validation', 'invalid stored membership status');
  return parsed.data;
}
