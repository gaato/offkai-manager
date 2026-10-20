import { read } from '$lib/server/db/client';
import { sql } from 'drizzle-orm';
import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
import {
  auditLogs,
  externalAccounts,
  organizationMemberships,
  organizations,
  users
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  authorizeOrganizationRole,
  changeRole,
  createOrganization,
  disableMembership,
  enableMembership,
  inviteMember,
  listOrganizationMembers,
  OrganizationError
} from '$lib/server/domain/orgs';
import { organizationRoles, roleAtLeast } from '$lib/shared/organization';
import { populateRequestSession } from '$lib/server/auth/request-session';
import { SESSION_COOKIE_NAME, signSession } from '$lib/server/auth/session';

describe('organization domain', () => {
  let client: DatabaseClient;
  let ownerId: string;
  let invitedId: string;
  let organizerId: string;
  let staffId: string;
  let viewerId: string;
  const discordIds = {
    owner: '100000000000000001',
    invited: '100000000000000002',
    organizer: '100000000000000003',
    staff: '100000000000000004',
    viewer: '100000000000000005'
  } as const;
  const expectedCapabilities = {
    viewer: {
      canManageTeam: false,
      canManageEvent: false,
      canManageRegistrationForm: false,
      canManageDiscord: false,
      canManageCollection: false,
      canManageStripe: false,
      canOperateParticipants: false,
      canCheckIn: false,
      canRecordPayments: false,
      canWaivePayments: false,
      canViewAudit: false
    },
    staff: {
      canManageTeam: false,
      canManageEvent: false,
      canManageRegistrationForm: false,
      canManageDiscord: false,
      canManageCollection: false,
      canManageStripe: false,
      canOperateParticipants: false,
      canCheckIn: true,
      canRecordPayments: true,
      canWaivePayments: false,
      canViewAudit: true
    },
    organizer: {
      canManageTeam: false,
      canManageEvent: true,
      canManageRegistrationForm: true,
      canManageDiscord: true,
      canManageCollection: true,
      canManageStripe: false,
      canOperateParticipants: true,
      canCheckIn: true,
      canRecordPayments: true,
      canWaivePayments: true,
      canViewAudit: true
    },
    owner: {
      canManageTeam: true,
      canManageEvent: true,
      canManageRegistrationForm: true,
      canManageDiscord: true,
      canManageCollection: true,
      canManageStripe: true,
      canOperateParticipants: true,
      canCheckIn: true,
      canRecordPayments: true,
      canWaivePayments: true,
      canViewAudit: true
    }
  } as const;
  beforeEach(async () => {
    client = testDatabase();
    ownerId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: discordIds.owner,
          username: 'owner',
          displayName: 'Owner',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
    invitedId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: discordIds.invited,
          username: 'invited',
          displayName: 'Invited',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
    organizerId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: discordIds.organizer,
          username: 'organizer',
          displayName: 'Organizer',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
    staffId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: discordIds.staff,
          username: 'staff',
          displayName: 'Staff',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
    viewerId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: discordIds.viewer,
          username: 'viewer',
          displayName: 'Viewer',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });
  it('creates the owner atomically and audits every membership mutation', async () => {
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: 'Domain Organization'
      },
      fixedClock
    );
    expect(organization).toMatchObject({ slug: 'domain-organization', actorRole: 'owner' });
    let members = await listOrganizationMembers(client, ownerId, organization.id);
    expect(members).toHaveLength(1);
    const owner = members[0];
    await expect(
      changeRole(
        client,
        { actorUserId: ownerId, membershipId: owner.id, role: 'organizer' },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'last_owner' } satisfies Partial<OrganizationError>);
    await expect(
      disableMembership(client, { actorUserId: ownerId, membershipId: owner.id }, fixedClock)
    ).rejects.toMatchObject({ code: 'last_owner' } satisfies Partial<OrganizationError>);
    const invited = await inviteMember(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        discordUserId: discordIds.invited,
        role: 'organizer'
      },
      fixedClock
    );
    expect(invited.userId).toBe(invitedId);
    await changeRole(
      client,
      {
        actorUserId: ownerId,
        membershipId: invited.id,
        role: 'staff',
        reason: 'coverage'
      },
      fixedClock
    );
    await disableMembership(
      client,
      {
        actorUserId: ownerId,
        membershipId: invited.id,
        reason: 'coverage'
      },
      fixedClock
    );
    const reinvited = await inviteMember(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        discordUserId: discordIds.invited,
        role: 'viewer'
      },
      fixedClock
    );
    expect(reinvited).toMatchObject({ id: invited.id, role: 'viewer', status: 'active' });
    await disableMembership(client, { actorUserId: ownerId, membershipId: invited.id }, fixedClock);
    await enableMembership(client, { actorUserId: ownerId, membershipId: invited.id }, fixedClock);
    members = await listOrganizationMembers(client, ownerId, organization.id);
    expect(members).toHaveLength(2);
    const audits = client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetType, 'organization_membership'))
      .all();
    expect(audits.map(({ action }) => action)).toEqual([
      'membership.invite',
      'membership.role_change',
      'membership.disable',
      'membership.invite',
      'membership.disable',
      'membership.enable'
    ]);
  });
  it('creates distinct readable slugs for Japanese-only names and keeps them immutable', async () => {
    const first = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: '東京オフ会'
      },
      fixedClock
    );
    const second = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: '大阪交流会'
      },
      fixedClock
    );
    expect(first.slug).toMatch(/^[a-z0-9]{7}$/);
    expect(second.slug).toMatch(/^[a-z0-9]{7}$/);
    expect(second.slug).not.toBe(first.slug);
    const persisted = client.db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, first.id))
      .limit(1)
      .all();
    expect(persisted[0]?.slug).toBe(first.slug);
  });
  it('serializes concurrent owner changes so one active owner remains', async () => {
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: 'Concurrent Owners'
      },
      fixedClock
    );
    const invited = await inviteMember(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        discordUserId: discordIds.invited,
        role: 'organizer'
      },
      fixedClock
    );
    await changeRole(
      client,
      {
        actorUserId: ownerId,
        membershipId: invited.id,
        role: 'owner'
      },
      fixedClock
    );
    const members = await listOrganizationMembers(client, ownerId, organization.id);
    const ownerMembership = members.find(({ userId }) => userId === ownerId);
    expect(ownerMembership).toBeDefined();
    const changes = await Promise.allSettled([
      changeRole(
        client,
        {
          actorUserId: ownerId,
          membershipId: ownerMembership!.id,
          role: 'organizer'
        },
        fixedClock
      ),
      changeRole(
        client,
        {
          actorUserId: ownerId,
          membershipId: invited.id,
          role: 'organizer'
        },
        fixedClock
      )
    ]);
    expect(changes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(changes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const activeOwners = client.db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organization.id))
      .all();
    const ownerRows = await client.db.all<{
      count: number;
    }>(sql`
      select count(*) as count
      from organization_memberships
      where organization_id = ${organization.id}
        and role = 'owner'
        and status = 'active'
    `);
    expect(activeOwners).toHaveLength(2);
    expect(ownerRows[0].count).toBe(1);
  });
  it('enforces the complete role matrix and rejects every disabled membership', async () => {
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: 'Authorization Matrix'
      },
      fixedClock
    );
    const memberships = {
      organizer: await inviteMember(
        client,
        {
          actorUserId: ownerId,
          organizationId: organization.id,
          discordUserId: discordIds.organizer,
          role: 'organizer'
        },
        fixedClock
      ),
      staff: await inviteMember(
        client,
        {
          actorUserId: ownerId,
          organizationId: organization.id,
          discordUserId: discordIds.staff,
          role: 'staff'
        },
        fixedClock
      ),
      viewer: await inviteMember(
        client,
        {
          actorUserId: ownerId,
          organizationId: organization.id,
          discordUserId: discordIds.viewer,
          role: 'viewer'
        },
        fixedClock
      )
    };
    const usersByRole = {
      owner: ownerId,
      organizer: organizerId,
      staff: staffId,
      viewer: viewerId
    } as const;
    for (const role of organizationRoles) {
      for (const minimumRole of organizationRoles) {
        const authorization = () =>
          read(client, (tx) =>
            authorizeOrganizationRole(tx, organization.id, usersByRole[role], minimumRole)
          );
        if (roleAtLeast(role, minimumRole)) {
          expect(authorization()).toMatchObject({
            role,
            capabilities: expectedCapabilities[role]
          });
        } else {
          expect(authorization).toThrow(OrganizationError);
        }
      }
    }
    for (const role of ['viewer', 'staff', 'organizer'] as const) {
      await disableMembership(
        client,
        {
          actorUserId: ownerId,
          membershipId: memberships[role].id
        },
        fixedClock
      );
      expect(() =>
        read(client, (tx) =>
          authorizeOrganizationRole(tx, organization.id, usersByRole[role], 'viewer')
        )
      ).toThrow(OrganizationError);
    }
    await enableMembership(
      client,
      {
        actorUserId: ownerId,
        membershipId: memberships.organizer.id
      },
      fixedClock
    );
    await changeRole(
      client,
      {
        actorUserId: ownerId,
        membershipId: memberships.organizer.id,
        role: 'owner'
      },
      fixedClock
    );
    const ownerMembership = (await listOrganizationMembers(client, ownerId, organization.id)).find(
      ({ userId }) => userId === ownerId
    );
    expect(ownerMembership).toBeDefined();
    await disableMembership(
      client,
      {
        actorUserId: organizerId,
        membershipId: ownerMembership!.id
      },
      fixedClock
    );
    expect(() =>
      read(client, (tx) => authorizeOrganizationRole(tx, organization.id, ownerId, 'viewer'))
    ).toThrow(OrganizationError);
  });
  it('upserts a Discord identity idempotently and refreshes its snapshots', async () => {
    const providerUserId = '100000000000000099';
    const first = await upsertDiscordIdentity(
      client,
      {
        providerUserId,
        username: 'first-name',
        displayName: 'First name',
        avatarUrl: 'https://cdn.example/first.png'
      },
      fixedClock
    );
    const second = await upsertDiscordIdentity(
      client,
      {
        providerUserId,
        username: 'current-name',
        displayName: 'Current name',
        avatarUrl: 'https://cdn.example/current.png'
      },
      fixedClock
    );
    expect(second.userId).toBe(first.userId);
    const accounts = client.db
      .select({
        userId: externalAccounts.userId,
        username: externalAccounts.username,
        displayName: externalAccounts.displayName,
        avatarUrl: externalAccounts.avatarUrl
      })
      .from(externalAccounts)
      .where(
        and(
          eq(externalAccounts.provider, 'discord'),
          eq(externalAccounts.providerUserId, providerUserId)
        )
      )
      .all();
    expect(accounts).toEqual([
      {
        userId: first.userId,
        username: 'current-name',
        displayName: 'Current name',
        avatarUrl: 'https://cdn.example/current.png'
      }
    ]);
  });
  it('rejects a suspended session and clears its cookie', async () => {
    client.db
      .update(users)
      .set({ suspendedAt: new Date('2026-10-21T00:00:00.000Z') })
      .where(eq(users.id, viewerId))
      .run();
    const config = loadConfig({
      OFFKAI_DATABASE_PATH: ':memory:',
      OFFKAI_SESSION_SECRET: 'organization-integration-secret',
      OFFKAI_AUTH_DEV_BYPASS: 'false',
      OFFKAI_DISCORD_CLIENT_ID: 'integration-client',
      OFFKAI_DISCORD_CLIENT_SECRET: 'integration-secret',
      OFFKAI_DISCORD_REDIRECT_URL: 'http://127.0.0.1/auth/discord/callback'
    });
    const token = signSession(
      { userId: viewerId, displayName: 'Viewer', platformAdmin: false },
      config.auth.sessionSecret
    );
    const deleted: Array<{
      name: string;
      options: unknown;
    }> = [];
    const event = {
      cookies: {
        get: (name: string) => (name === SESSION_COOKIE_NAME ? token : undefined),
        delete: (name: string, options: unknown) => deleted.push({ name, options })
      },
      locals: {
        session: {
          userId: viewerId,
          displayName: 'Viewer',
          platformAdmin: false,
          issuedAt: 0,
          expiresAt: Number.MAX_SAFE_INTEGER
        }
      },
      request: new Request('http://127.0.0.1/app'),
      url: new URL('http://127.0.0.1/app')
    };
    await populateRequestSession(event, config, client);
    expect(event.locals.session).toBeNull();
    expect(deleted).toEqual([
      {
        name: SESSION_COOKIE_NAME,
        options: { path: '/', httpOnly: true, sameSite: 'lax', secure: false }
      }
    ]);
  });
});
