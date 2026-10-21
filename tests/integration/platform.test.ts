import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
import { auditLogs } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  createEvent,
  getEventAccess,
  publishEvent,
  updateSettings
} from '$lib/server/domain/events';
import { createOrganization, OrganizationError } from '$lib/server/domain/orgs';
import type { ConnectGateway } from '$lib/server/domain/payments';
import { startOnboarding } from '$lib/server/domain/payments';
import {
  getPlatformOrganization,
  PlatformError,
  searchPlatformActivity,
  setOrganizationSuspension,
  setUserSuspension
} from '$lib/server/domain/platform';
import {
  createRegistration,
  getPublicEventBySlug,
  RegistrationError
} from '$lib/server/domain/registrations';

class NeverConnectGateway implements ConnectGateway {
  calls = 0;
  createAccount(): Promise<{
    accountId: string;
  }> {
    this.calls += 1;
    return Promise.resolve({ accountId: 'acct_should_not_exist' });
  }
  createAccountLink(): Promise<{
    url: string;
  }> {
    throw new Error('gateway must not be called');
  }
  getAccount(): Promise<never> {
    throw new Error('gateway must not be called');
  }
}

describe('platform suspension domain', () => {
  let client: DatabaseClient;
  let adminUserId: string;
  let targetUserId: string;
  beforeEach(async () => {
    client = testDatabase();
    adminUserId = await createUser('190000000000000001', 'Platform Admin');
    targetUserId = await createUser('190000000000000002', 'Platform Target');
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });
  it('suspends and restores an organization atomically with exact audit actions', async () => {
    const { organization, event } = await publishedFixture('Platform enforcement');
    await expect(
      getPublicEventBySlug(client, organization.slug, event.slug)
    ).resolves.toMatchObject({ event: { id: event.id } });
    await expect(
      setOrganizationSuspension(
        client,
        {
          actorUserId: adminUserId,
          targetId: organization.id,
          suspended: true,
          reason: '   '
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<PlatformError>);
    await setOrganizationSuspension(
      client,
      {
        actorUserId: adminUserId,
        targetId: organization.id,
        suspended: true,
        reason: 'Policy investigation'
      },
      fixedClock
    );
    const detail = await getPlatformOrganization(client, organization.id);
    expect(detail.organization.suspendedAt).not.toBeNull();
    await expect(getPublicEventBySlug(client, organization.slug, event.slug)).rejects.toMatchObject(
      { code: 'not_found' } satisfies Partial<RegistrationError>
    );
    await expect(
      createRegistration(
        client,
        {
          organizationSlug: organization.slug,
          eventSlug: event.slug,
          userId: targetUserId,
          displayName: 'Platform Target',
          answers: []
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<RegistrationError>);
    await expect(getEventAccess(client, adminUserId, event.id)).resolves.toMatchObject({
      organizationSuspendedAt: expect.any(Date)
    });
    await expect(
      createEvent(
        client,
        {
          actorUserId: adminUserId,
          organizationId: organization.id,
          title: 'Blocked mutation',
          startsAt: '2027-12-02T18:00',
          timeZone: 'Asia/Tokyo'
        },
        undefined,
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
    const connect = new NeverConnectGateway();
    await expect(
      startOnboarding(
        client,
        connect,
        {
          organizationId: organization.id,
          actor: { userId: adminUserId },
          returnUrl: 'https://example.test/return',
          refreshUrl: 'https://example.test/refresh'
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(connect.calls).toBe(0);
    await setOrganizationSuspension(
      client,
      {
        actorUserId: adminUserId,
        targetId: organization.id,
        suspended: false
      },
      fixedClock
    );
    await expect(
      getPublicEventBySlug(client, organization.slug, event.slug)
    ).resolves.toMatchObject({ event: { id: event.id } });
    await expect(
      createRegistration(
        client,
        {
          organizationSlug: organization.slug,
          eventSlug: event.slug,
          userId: targetUserId,
          displayName: 'Platform Target',
          answers: []
        },
        fixedClock
      )
    ).resolves.toMatchObject({ status: 'confirmed' });
    const audits = client.db
      .select({ action: auditLogs.action, reason: auditLogs.reason })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, organization.id))
      .all();
    expect(audits.filter(({ action }) => action.startsWith('platform.'))).toEqual([
      { action: 'platform.org_suspend', reason: 'Policy investigation' },
      { action: 'platform.org_unsuspend', reason: '' }
    ]);
  });
  it('suspends users, rejects self-suspension, and records both transitions', async () => {
    await expect(
      setUserSuspension(
        client,
        {
          actorUserId: adminUserId,
          targetId: adminUserId,
          suspended: true,
          reason: 'Mistake'
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'self_suspend' } satisfies Partial<PlatformError>);
    await setUserSuspension(
      client,
      {
        actorUserId: adminUserId,
        targetId: targetUserId,
        suspended: true,
        reason: 'Abuse report'
      },
      fixedClock
    );
    await setUserSuspension(
      client,
      {
        actorUserId: adminUserId,
        targetId: targetUserId,
        suspended: false
      },
      fixedClock
    );
    const audits = client.db
      .select({ action: auditLogs.action, reason: auditLogs.reason })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, targetUserId))
      .all();
    expect(audits.filter(({ action }) => action.startsWith('platform.'))).toEqual([
      { action: 'platform.user_suspend', reason: 'Abuse report' },
      { action: 'platform.user_unsuspend', reason: '' }
    ]);
  });
  it('filters audit activity by literal action prefix and target with stable pagination', async () => {
    const organization = await createOrganization(
      client,
      {
        actorUserId: adminUserId,
        name: 'Activity Pagination'
      },
      fixedClock
    );
    client.db
      .insert(auditLogs)
      .values(
        Array.from({ length: 55 }, (_, index) => ({
          actorUserId: adminUserId,
          action: `payment.bulk_${index}`,
          targetType: 'organization',
          targetId: organization.id
        })).map((row) => ({ createdAt: fixedClock.now(), ...row }))
      )
      .run();
    const first = await searchPlatformActivity(client, {
      actionPrefix: 'payment.bulk_',
      targetId: organization.id,
      page: 1
    });
    const second = await searchPlatformActivity(client, {
      actionPrefix: 'payment.bulk_',
      targetId: organization.id,
      page: 2
    });
    expect(first).toMatchObject({ hasPrevious: false, hasNext: true });
    expect(first.rows).toHaveLength(50);
    expect(second).toMatchObject({ hasPrevious: true, hasNext: false });
    expect(second.rows).toHaveLength(5);
  });
  async function createUser(discordUserId: string, displayName: string): Promise<string> {
    return (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: discordUserId,
          username: displayName.toLowerCase().replaceAll(' ', '-'),
          displayName,
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
  }
  async function publishedFixture(name: string) {
    const organization = await createOrganization(
      client,
      { actorUserId: adminUserId, name },
      fixedClock
    );
    const event = await createEvent(
      client,
      {
        actorUserId: adminUserId,
        organizationId: organization.id,
        title: `${name} Event`,
        startsAt: '2027-12-01T18:00',
        timeZone: 'Asia/Tokyo'
      },
      () => 'platform-enforcement-event',
      fixedClock
    );
    await updateSettings(
      client,
      {
        actorUserId: adminUserId,
        eventId: event.id,
        title: event.title,
        description: '',
        startsAt: '2027-12-01T18:00',
        endsAt: '2027-12-01T21:00',
        capacity: null,
        venueName: '',
        venueAddress: '',
        venueReveal: 'public',
        contact: '',
        cancellationPolicy: '',
        registrationOpensAt: '2026-01-01T00:00',
        registrationClosesAt: '2027-12-01T17:00',
        registrationMode: 'auto_confirm',
        discordPolicy: 'not_used',
        timeZone: 'Asia/Tokyo'
      },
      fixedClock
    );
    return {
      organization,
      event: await publishEvent(client, { actorUserId: adminUserId, eventId: event.id }, fixedClock)
    };
  }
});
