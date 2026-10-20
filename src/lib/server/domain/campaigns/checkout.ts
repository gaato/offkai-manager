import { eq } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  campaigns,
  orders,
  organizations,
  stripeConnectAccounts,
  users
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { generateOrderAccessToken } from '$lib/server/domain/orders/access-token';
import type { PaymentGateway } from '$lib/server/domain/payments/gateway';
import { CampaignError } from './errors';
import type { StartPledgeCheckoutInput, StartPledgeCheckoutResult } from './types';

export const pledgeAccessTokenPlaceholder = '{access_token}';
const pledgeCheckoutLifetimeMs = 60 * 60 * 1_000;
const postgresBigintMax = 9_223_372_036_854_775_807n;

interface PledgeCheckoutIntent {
  orderId: string;
  actorUserId: string | null;
  accessToken: string;
  campaignTitle: string;
  unitPriceMinor: bigint;
  currency: string;
  unitCount: number;
  stripeAccountId: string;
}

/** Creates a campaign order, opens hosted Checkout, and attaches the resulting session. */
export async function startPledgeCheckout(
  client: DatabaseClient,
  gateway: PaymentGateway,
  input: StartPledgeCheckoutInput
): Promise<StartPledgeCheckoutResult> {
  if (!input.successUrl || !input.cancelUrl) {
    throw new CampaignError('validation', 'checkout return URLs are required');
  }
  if (typeof input.listPublicly !== 'boolean') {
    throw new CampaignError('validation', 'public supporter consent must be explicit');
  }

  const intent = await client.db.transaction((tx) => beginPledgeCheckout(tx, input));
  let session;
  try {
    session = await gateway.createCheckoutSession({
      referenceId: intent.orderId,
      productName: intent.campaignTitle,
      amountMinor: intent.unitPriceMinor,
      currency: intent.currency,
      quantity: intent.unitCount,
      stripeAccountId: intent.stripeAccountId,
      successUrl: input.successUrl.replaceAll(pledgeAccessTokenPlaceholder, intent.accessToken),
      cancelUrl: input.cancelUrl.replaceAll(pledgeAccessTokenPlaceholder, intent.accessToken),
      idempotencyKey: `pledge-${intent.orderId}`,
      expireAfter: pledgeCheckoutLifetimeMs
    });
  } catch (cause) {
    // The committed pending row has no session and never affects paid-only tallies.
    // Keeping it is safer than trying to compensate across the external call boundary.
    throw new CampaignError('gateway', 'create pledge checkout session failed', { cause });
  }
  if (!session.sessionId || !session.url) {
    throw new CampaignError('gateway', 'checkout gateway returned an incomplete session');
  }

  await attachPledgeCheckout(client, intent, session);
  return { checkoutUrl: session.url, accessToken: intent.accessToken };
}

async function beginPledgeCheckout(
  tx: DatabaseTransaction,
  input: StartPledgeCheckoutInput
): Promise<PledgeCheckoutIntent> {
  const displayName = input.displayName.trim();
  if (!displayName || [...displayName].length > 64) {
    throw new CampaignError('validation', 'supporter display name must be 1 to 64 characters');
  }
  const rows = await tx
    .select({
      campaign: campaigns,
      organizationSuspendedAt: organizations.suspendedAt,
      stripeAccountId: stripeConnectAccounts.stripeAccountId,
      connectStatus: stripeConnectAccounts.onboardingStatus,
      chargesEnabled: stripeConnectAccounts.chargesEnabled
    })
    .from(campaigns)
    .innerJoin(organizations, eq(organizations.id, campaigns.organizationId))
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.organizationId, campaigns.organizationId)
    )
    .where(eq(campaigns.id, input.campaignId))
    .limit(1)
    .for('update', { of: campaigns });
  const row = rows[0];
  if (!row) throw new CampaignError('not_found', 'campaign not found');
  if (row.organizationSuspendedAt || row.campaign.status !== 'open') {
    throw new CampaignError('not_payable', 'campaign is not accepting pledges');
  }
  if (!row.stripeAccountId || row.connectStatus !== 'ready' || row.chargesEnabled !== true) {
    throw new CampaignError('not_ready', 'organization has no ready Stripe account');
  }
  if (
    !Number.isInteger(input.unitCount) ||
    input.unitCount < 1 ||
    input.unitCount > row.campaign.maxUnitsPerPledge
  ) {
    throw new CampaignError(
      'validation',
      `pledge unit count must be 1 to ${row.campaign.maxUnitsPerPledge}`
    );
  }
  if (row.campaign.unitPriceMinor > postgresBigintMax / BigInt(input.unitCount)) {
    throw new CampaignError('validation', 'pledge amount is too large');
  }

  const userId = input.userId?.trim() || null;
  if (userId) {
    const userRows = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!userRows[0]) throw new CampaignError('validation', 'pledge user does not exist');
  }
  const accessToken = generateOrderAccessToken();
  const inserted = await tx
    .insert(orders)
    .values({
      campaignId: row.campaign.id,
      userId,
      displayName,
      listPublicly: input.listPublicly,
      unitCount: input.unitCount,
      unitPriceMinor: row.campaign.unitPriceMinor,
      amountMinor: row.campaign.unitPriceMinor * BigInt(input.unitCount),
      currency: row.campaign.currency,
      status: 'pending',
      accessToken
    })
    .returning({ id: orders.id });
  await appendAudit(tx, {
    actorUserId: userId,
    eventId: null,
    action: 'campaign.pledge_checkout_begin',
    targetType: 'order',
    targetId: inserted[0].id,
    after: {
      campaignId: row.campaign.id,
      status: 'pending',
      unitCount: input.unitCount,
      amountMinor: (row.campaign.unitPriceMinor * BigInt(input.unitCount)).toString(),
      currency: row.campaign.currency
    }
  });
  return {
    orderId: inserted[0].id,
    actorUserId: userId,
    accessToken,
    campaignTitle: row.campaign.title,
    unitPriceMinor: row.campaign.unitPriceMinor,
    currency: row.campaign.currency,
    unitCount: input.unitCount,
    stripeAccountId: row.stripeAccountId
  };
}

async function attachPledgeCheckout(
  client: DatabaseClient,
  intent: PledgeCheckoutIntent,
  session: { sessionId: string; paymentIntentId?: string }
): Promise<void> {
  await client.db.transaction(async (tx) => {
    const rows = await tx
      .select({ order: orders })
      .from(orders)
      .where(eq(orders.id, intent.orderId))
      .limit(1)
      .for('update');
    const order = rows[0]?.order;
    if (!order || order.status !== 'pending' || order.checkoutSessionId) {
      throw new CampaignError('conflict', 'pledge order is no longer payable');
    }
    await tx
      .update(orders)
      .set({
        stripeAccountId: intent.stripeAccountId,
        checkoutSessionId: session.sessionId,
        paymentIntentId: session.paymentIntentId ?? '',
        status: 'payment_pending',
        updatedAt: new Date()
      })
      .where(eq(orders.id, intent.orderId));
    await appendAudit(tx, {
      actorUserId: intent.actorUserId,
      eventId: null,
      action: 'campaign.pledge_checkout_attach',
      targetType: 'order',
      targetId: intent.orderId,
      before: { status: order.status },
      after: { status: 'payment_pending', stripeAccountSnapshotted: true }
    });
  });
}
