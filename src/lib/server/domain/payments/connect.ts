import { eq } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import { stripeConnectAccounts } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole, OrganizationError } from '$lib/server/domain/orgs';
import type { ConnectAccount, ConnectGateway } from './gateway';
import { stripeOnboardingStatusSchema, type StripeOnboardingStatus } from '$lib/shared/payment';
import { ConnectError } from './errors';

export interface ConnectActor {
  userId: string;
}

export interface ConnectAccountRecord extends ConnectAccount {
  id: string;
  organizationId: string;
  stripeAccountId: string;
  onboardingStatus: StripeOnboardingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingInput {
  organizationId: string;
  actor: ConnectActor;
  returnUrl: string;
  refreshUrl: string;
}

/** Ensures one persisted Express account and returns a fresh single-use onboarding link. */
export async function startOnboarding(
  client: DatabaseClient,
  gateway: ConnectGateway,
  input: OnboardingInput
): Promise<string> {
  let account = await findAuthorizedAccount(client, input.organizationId, input.actor, 'owner');
  if (!account) {
    const created = await gateway.createExpressAccount({ organizationId: input.organizationId });
    try {
      account = await client.db.transaction(async (tx) => {
        await authorizeOwner(tx, input.organizationId, input.actor);
        const concurrent = await findAccount(tx, input.organizationId);
        if (concurrent) return concurrent;

        const rows = await tx
          .insert(stripeConnectAccounts)
          .values({
            organizationId: input.organizationId,
            stripeAccountId: created.accountId,
            dashboardType: 'express',
            onboardingStatus: 'onboarding_required'
          })
          .returning();
        const persisted = parseAccount(rows[0]);
        await appendAudit(tx, {
          actorUserId: input.actor.userId,
          action: 'stripe.onboard_start',
          targetType: 'stripe_connect_account',
          targetId: persisted.id,
          after: { onboardingStatus: persisted.onboardingStatus }
        });
        return persisted;
      });
    } catch (cause) {
      if (!isOrganizationAccountCollision(cause)) throw cause;
      account = await findAuthorizedAccount(client, input.organizationId, input.actor, 'owner');
      if (!account) throw cause;
    }
  }
  return createLink(gateway, account.stripeAccountId, input);
}

/** Refreshes the stored flags from Stripe and audits only an onboarding-status transition. */
export async function syncAccount(
  client: DatabaseClient,
  gateway: ConnectGateway,
  organizationId: string,
  actor: ConnectActor
): Promise<ConnectAccountRecord> {
  return client.db.transaction(async (tx) => {
    await authorizeOwner(tx, organizationId, actor);
    const current = await findAccount(tx, organizationId, true);
    if (!current) throw new ConnectError('not_connected', 'organization has no Stripe account');

    const live = await gateway.getAccount(current.stripeAccountId);
    const onboardingStatus = onboardingStatusForAccount(live);
    const rows = await tx
      .update(stripeConnectAccounts)
      .set({
        dashboardType: live.dashboardType,
        chargesEnabled: live.chargesEnabled,
        payoutsEnabled: live.payoutsEnabled,
        detailsSubmitted: live.detailsSubmitted,
        onboardingStatus,
        country: live.country,
        defaultCurrency: live.defaultCurrency.toLowerCase(),
        updatedAt: new Date()
      })
      .where(eq(stripeConnectAccounts.id, current.id))
      .returning();
    const updated = parseAccount(rows[0]);
    if (updated.onboardingStatus !== current.onboardingStatus) {
      await appendAudit(tx, {
        actorUserId: actor.userId,
        action: 'stripe.status_change',
        targetType: 'stripe_connect_account',
        targetId: updated.id,
        before: { onboardingStatus: current.onboardingStatus },
        after: { onboardingStatus: updated.onboardingStatus },
        reason: `${current.onboardingStatus} -> ${updated.onboardingStatus}`
      });
    }
    return updated;
  });
}

export function handleReturn(
  client: DatabaseClient,
  gateway: ConnectGateway,
  organizationId: string,
  actor: ConnectActor
): Promise<ConnectAccountRecord> {
  return syncAccount(client, gateway, organizationId, actor);
}

/** Replaces an expired account link without creating or changing the connected account. */
export async function refreshOnboarding(
  client: DatabaseClient,
  gateway: ConnectGateway,
  input: OnboardingInput
): Promise<string> {
  const account = await findAuthorizedAccount(client, input.organizationId, input.actor, 'owner');
  if (!account) throw new ConnectError('not_connected', 'organization has no Stripe account');
  return createLink(gateway, account.stripeAccountId, input);
}

/** Loads persisted billing state for any active organization member. */
export function getConnectAccount(
  client: DatabaseClient,
  organizationId: string,
  actor: ConnectActor
): Promise<ConnectAccountRecord | null> {
  return findAuthorizedAccount(client, organizationId, actor, 'viewer');
}

/** Exact legacy mapping: payouts do not participate in onboarding readiness. */
export function onboardingStatusForAccount(account: ConnectAccount): StripeOnboardingStatus {
  if (account.chargesEnabled && account.detailsSubmitted) return 'ready';
  if (account.detailsSubmitted) return 'pending_verification';
  return 'onboarding_required';
}

async function createLink(
  gateway: ConnectGateway,
  stripeAccountId: string,
  input: Pick<OnboardingInput, 'returnUrl' | 'refreshUrl'>
): Promise<string> {
  const link = await gateway.createAccountLink({
    accountId: stripeAccountId,
    returnUrl: input.returnUrl,
    refreshUrl: input.refreshUrl
  });
  return link.url;
}

async function findAuthorizedAccount(
  client: DatabaseClient,
  organizationId: string,
  actor: ConnectActor,
  role: 'viewer' | 'owner'
): Promise<ConnectAccountRecord | null> {
  return client.db.transaction(async (tx) => {
    if (role === 'owner') await authorizeOwner(tx, organizationId, actor);
    else await authorizeOrganizationRole(tx, organizationId, actor.userId, 'viewer', false, true);
    return findAccount(tx, organizationId);
  });
}

async function authorizeOwner(
  tx: DatabaseTransaction,
  organizationId: string,
  actor: ConnectActor
): Promise<void> {
  try {
    await authorizeOrganizationRole(tx, organizationId, actor.userId, 'owner');
  } catch (cause) {
    if (cause instanceof OrganizationError && cause.code === 'forbidden') {
      throw new ConnectError('forbidden', 'only an organization owner can manage Stripe', {
        cause
      });
    }
    if (cause instanceof OrganizationError && cause.code === 'not_found') {
      throw new ConnectError('not_found', 'organization not found', { cause });
    }
    throw cause;
  }
}

async function findAccount(
  tx: DatabaseTransaction,
  organizationId: string,
  lock = false
): Promise<ConnectAccountRecord | null> {
  const query = tx
    .select()
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.organizationId, organizationId))
    .limit(1);
  const rows = lock ? await query.for('update') : await query;
  return rows[0] ? parseAccount(rows[0]) : null;
}

function parseAccount(row: typeof stripeConnectAccounts.$inferSelect): ConnectAccountRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stripeAccountId: row.stripeAccountId,
    dashboardType:
      row.dashboardType === 'express' || row.dashboardType === 'full' ? row.dashboardType : 'none',
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    onboardingStatus: stripeOnboardingStatusSchema.parse(row.onboardingStatus),
    country: row.country,
    defaultCurrency: row.defaultCurrency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function isOrganizationAccountCollision(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const postgresError = cause as { cause?: unknown; code?: unknown; constraint_name?: unknown };
  return (
    (postgresError.code === '23505' &&
      postgresError.constraint_name === 'stripe_connect_accounts_organization_id_key') ||
    isOrganizationAccountCollision(postgresError.cause)
  );
}
