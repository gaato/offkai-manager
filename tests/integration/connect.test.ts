import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, count, eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { auditLogs, stripeConnectAccounts } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import type { ConnectAccount, ConnectGateway } from '$lib/server/domain/payments/gateway';
import {
  ConnectError,
  startOnboarding,
  syncAccount,
  type OnboardingInput
} from '$lib/server/domain/payments';
import { createOrganization, inviteMember } from '$lib/server/domain/orgs';

let fakeAccountSequence = 0;

class FakeConnectGateway implements ConnectGateway {
  createCalls = 0;
  getCalls = 0;
  readonly accounts = new Map<string, ConnectAccount>();
  private readonly barrier: Promise<void> | null;
  private releaseBarrier: (() => void) | null = null;

  constructor(expectedParallelCreates = 0) {
    this.barrier = expectedParallelCreates
      ? new Promise((resolve) => {
          this.releaseBarrier = resolve;
        })
      : null;
    this.expectedParallelCreates = expectedParallelCreates;
  }

  private readonly expectedParallelCreates: number;

  async createExpressAccount(): Promise<{ accountId: string }> {
    this.createCalls += 1;
    fakeAccountSequence += 1;
    const accountId = `acct_test_${fakeAccountSequence}`;
    this.accounts.set(accountId, liveAccount());
    if (this.createCalls === this.expectedParallelCreates) this.releaseBarrier?.();
    if (this.barrier) await this.barrier;
    return { accountId };
  }

  async createAccountLink(input: { accountId: string }): Promise<{ url: string }> {
    if (!this.accounts.has(input.accountId)) throw new Error('test account not found');
    return { url: `/stripe-test/${input.accountId}` };
  }

  async getAccount(accountId: string): Promise<ConnectAccount> {
    this.getCalls += 1;
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('test account not found');
    return account;
  }
}

function liveAccount(overrides: Partial<ConnectAccount> = {}): ConnectAccount {
  return {
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    country: 'JP',
    defaultCurrency: 'JPY',
    dashboardType: 'express',
    ...overrides
  };
}

describe('Stripe Connect domain', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let organizerId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'connect-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    ownerId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '130000000000000001',
        username: 'connect-owner',
        displayName: 'Connect Owner',
        avatarUrl: ''
      })
    ).userId;
    organizerId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '130000000000000002',
        username: 'connect-organizer',
        displayName: 'Connect Organizer',
        avatarUrl: ''
      })
    ).userId;
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  function input(organizationId: string, actorId = ownerId): OnboardingInput {
    return {
      organizationId,
      actor: { userId: actorId },
      returnUrl: `https://example.test/app/organizations/${organizationId}/stripe/return`,
      refreshUrl: `https://example.test/app/organizations/${organizationId}/stripe/refresh`
    };
  }

  it('persists one account when two onboarding starts race', async () => {
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: 'Parallel Connect'
    });
    const gateway = new FakeConnectGateway(2);
    const urls = await Promise.all([
      startOnboarding(client, gateway, input(organization.id)),
      startOnboarding(client, gateway, input(organization.id))
    ]);

    const accounts = await client.db
      .select()
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.organizationId, organization.id));
    expect(accounts).toHaveLength(1);
    expect(new Set(urls)).toEqual(new Set([`/stripe-test/${accounts[0].stripeAccountId}`]));
    expect(gateway.createCalls).toBe(2);

    const auditCount = await client.db
      .select({ value: count(auditLogs.id) })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'stripe.onboard_start'));
    expect(auditCount[0].value).toBe(1);
  });

  it('ports the live-flag status mapping and audits transitions', async () => {
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: 'Connect Status Matrix'
    });
    const gateway = new FakeConnectGateway();
    await startOnboarding(client, gateway, input(organization.id));
    const accountId = [...gateway.accounts.keys()][0];
    const matrix = [
      [liveAccount(), 'onboarding_required'],
      [liveAccount({ chargesEnabled: true }), 'onboarding_required'],
      [liveAccount({ detailsSubmitted: true }), 'pending_verification'],
      [
        liveAccount({ chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: false }),
        'ready'
      ]
    ] as const;

    for (const [live, expected] of matrix) {
      gateway.accounts.set(accountId, live);
      const synced = await syncAccount(client, gateway, organization.id, { userId: ownerId });
      expect(synced.onboardingStatus).toBe(expected);
      expect(synced.defaultCurrency).toBe('jpy');
    }

    const audits = await client.db
      .select({ action: auditLogs.action, reason: auditLogs.reason })
      .from(auditLogs)
      .where(eq(auditLogs.targetType, 'stripe_connect_account'))
      .orderBy(asc(auditLogs.createdAt));
    expect(
      audits.filter(({ action }) => action === 'stripe.status_change').map(({ reason }) => reason)
    ).toEqual(['onboarding_required -> pending_verification', 'pending_verification -> ready']);
  });

  it('allows only owners to start or synchronize onboarding', async () => {
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: 'Owner Connect Only'
    });
    await inviteMember(client, {
      actorUserId: ownerId,
      organizationId: organization.id,
      discordUserId: '130000000000000002',
      role: 'organizer'
    });
    const gateway = new FakeConnectGateway();
    await expect(
      startOnboarding(client, gateway, input(organization.id, organizerId))
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<ConnectError>);
    expect(gateway.createCalls).toBe(0);

    await startOnboarding(client, gateway, input(organization.id));
    await expect(
      syncAccount(client, gateway, organization.id, { userId: organizerId })
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<ConnectError>);
    expect(gateway.getCalls).toBe(0);
  });
});
