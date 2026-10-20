import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
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
  input: OnboardingInput,
  clock: Clock = systemClock
): Promise<string> {
  let account = await findAuthorizedAccount(client, input.organizationId, input.actor, 'owner');
  if (!account) {
    const created = await gateway.createExpressAccount({ organizationId: input.organizationId });
    try {
      account = write(client, (tx) => {
        authorizeOwner(tx, input.organizationId, input.actor);
        const concurrent = findAccount(tx, input.organizationId);
        if (concurrent) return concurrent;
        const rows = tx
          .insert(stripeConnectAccounts)
          .values({
            createdAt: clock.now(),
            updatedAt: clock.now(),
            organizationId: input.organizationId,
            stripeAccountId: created.accountId,
            dashboardType: 'express',
            onboardingStatus: 'onboarding_required'
          })
          .returning()
          .all();
        const persisted = parseAccount(rows[0]);
        appendAudit(
          tx,
          {
            actorUserId: input.actor.userId,
            action: 'stripe.onboard_start',
            targetType: 'stripe_connect_account',
            targetId: persisted.id,
            after: { onboardingStatus: persisted.onboardingStatus }
          },
          clock
        );
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
  actor: ConnectActor,
  clock: Clock = systemClock
): Promise<ConnectAccountRecord> {
  const intent = read(client, (tx) => {
    authorizeOwner(tx, organizationId, actor);
    const current = findAccount(tx, organizationId);
    if (!current) throw new ConnectError('not_connected', 'organization has no Stripe account');
    return current;
  });
  const live = await gateway.getAccount(intent.stripeAccountId);
  return write(client, (tx) => {
    authorizeOwner(tx, organizationId, actor);
    const current = findAccount(tx, organizationId);
    if (
      !current ||
      current.id !== intent.id ||
      current.stripeAccountId !== intent.stripeAccountId
    ) {
      throw new ConnectError('not_connected', 'connected account changed during sync');
    }
    const onboardingStatus = onboardingStatusForAccount(live);
    const rows = tx
      .update(stripeConnectAccounts)
      .set({
        dashboardType: live.dashboardType,
        chargesEnabled: live.chargesEnabled,
        payoutsEnabled: live.payoutsEnabled,
        detailsSubmitted: live.detailsSubmitted,
        onboardingStatus,
        country: live.country,
        defaultCurrency: live.defaultCurrency.toLowerCase(),
        updatedAt: clock.now()
      })
      .where(eq(stripeConnectAccounts.id, current.id))
      .returning()
      .all();
    const updated = parseAccount(rows[0]);
    if (updated.onboardingStatus !== current.onboardingStatus) {
      appendAudit(
        tx,
        {
          actorUserId: actor.userId,
          action: 'stripe.status_change',
          targetType: 'stripe_connect_account',
          targetId: updated.id,
          before: { onboardingStatus: current.onboardingStatus },
          after: { onboardingStatus: updated.onboardingStatus },
          reason: `${current.onboardingStatus} -> ${updated.onboardingStatus}`
        },
        clock
      );
    }
    return updated;
  });
}

export async function handleReturn(
  client: DatabaseClient,
  gateway: ConnectGateway,
  organizationId: string,
  actor: ConnectActor,
  clock: Clock = systemClock
): Promise<ConnectAccountRecord> {
  return syncAccount(client, gateway, organizationId, actor, clock);
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
export async function getConnectAccount(
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
  return read(client, (tx) => {
    if (role === 'owner') authorizeOwner(tx, organizationId, actor);
    else authorizeOrganizationRole(tx, organizationId, actor.userId, 'viewer', true);
    return findAccount(tx, organizationId);
  });
}

function authorizeOwner(
  tx: DatabaseTransaction,
  organizationId: string,
  actor: ConnectActor
): void {
  try {
    authorizeOrganizationRole(tx, organizationId, actor.userId, 'owner');
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

function findAccount(tx: DatabaseTransaction, organizationId: string): ConnectAccountRecord | null {
  const query = tx
    .select()
    .from(stripeConnectAccounts)
    .where(eq(stripeConnectAccounts.organizationId, organizationId))
    .limit(1);
  const rows = query.all();
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
  const error = cause as {
    cause?: unknown;
    code?: unknown;
    message?: string;
  };
  return (
    (error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      error.message?.includes('stripe_connect_accounts.organization_id') === true) ||
    isOrganizationAccountCollision(error.cause)
  );
}
