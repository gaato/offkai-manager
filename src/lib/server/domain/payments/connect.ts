import { translate, type Locale } from '$lib/i18n';
import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { eq } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import { stripeConnectAccounts, stripeWebhookEvents } from '$lib/server/db/schema';
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

export interface AccountCreationInput extends OnboardingInput {
  publicBaseUrl: string;
  locale: Locale;
  merchantMcc: string;
}

/** Creates the organization’s v2 account once, including creation-only business prefill. */
export async function ensureConnectedAccount(
  client: DatabaseClient,
  gateway: ConnectGateway,
  input: AccountCreationInput,
  clock: Clock = systemClock
): Promise<ConnectAccountRecord> {
  let account = await findAuthorizedAccount(client, input.organizationId, input.actor, 'owner');
  if (!account) {
    const created = await gateway.createAccount({
      organizationId: input.organizationId,
      businessUrl: new URL(`/legal/${input.organizationId}`, input.publicBaseUrl).href,
      productDescription: translate(input.locale, 'stripe.product_description'),
      merchantMcc: input.merchantMcc
    });
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
            dashboardType: 'none',
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
  return account;
}

export async function startOnboarding(
  client: DatabaseClient,
  gateway: ConnectGateway,
  input: AccountCreationInput,
  clock: Clock = systemClock
): Promise<string> {
  const account = await ensureConnectedAccount(client, gateway, input, clock);
  return createLink(gateway, account.stripeAccountId, input);
}

export async function createEmbeddedSession(
  client: DatabaseClient,
  gateway: ConnectGateway,
  organizationId: string,
  actor: ConnectActor
) {
  const account = await findAuthorizedAccount(client, organizationId, actor, 'owner');
  if (!account || !gateway.createAccountSession)
    throw new ConnectError('not_connected', 'embedded account unavailable');
  return gateway.createAccountSession(account.stripeAccountId);
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
    const changed =
      current.dashboardType !== live.dashboardType ||
      current.chargesEnabled !== live.chargesEnabled ||
      current.payoutsEnabled !== live.payoutsEnabled ||
      current.detailsSubmitted !== live.detailsSubmitted ||
      current.country !== live.country ||
      current.defaultCurrency !== live.defaultCurrency.toLowerCase() ||
      current.onboardingStatus !== onboardingStatus;
    if (!changed) return current;
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
    {
      appendAudit(
        tx,
        {
          actorUserId: actor.userId,
          action:
            updated.onboardingStatus !== current.onboardingStatus
              ? 'stripe.status_change'
              : 'stripe.account_refresh',
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

/** Thin events are authenticated by the gateway; persist the live snapshot and ledger atomically. */
export function applyAccountNotification(
  client: DatabaseClient,
  input: { id: string; type: string; accountId: string; account: ConnectAccount },
  clock: Clock = systemClock
) {
  return write(client, (tx) => {
    const current = tx
      .select()
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.stripeAccountId, input.accountId))
      .get();
    if (!current) return;
    const inserted = tx
      .insert(stripeWebhookEvents)
      .values({
        stripeEventId: input.id,
        stripeAccountId: input.accountId,
        eventType: input.type,
        payloadJson: { accountId: input.accountId },
        processedAt: clock.now(),
        createdAt: clock.now()
      })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!inserted) return;
    const status = onboardingStatusForAccount(input.account);
    tx.update(stripeConnectAccounts)
      .set({ ...input.account, onboardingStatus: status, updatedAt: clock.now() })
      .where(eq(stripeConnectAccounts.id, current.id))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: null,
        action: 'stripe.status_change',
        targetType: 'stripe_connect_account',
        targetId: current.id,
        before: { onboardingStatus: current.onboardingStatus },
        after: { onboardingStatus: status }
      },
      clock
    );
  });
}
