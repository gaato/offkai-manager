import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  auditLogs,
  orders,
  organizations,
  stripeConnectAccounts,
  stripeWebhookEvents
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  CampaignError,
  changeCampaignStatus,
  createCampaign,
  pledgeAccessTokenPlaceholder,
  startPledgeCheckout,
  type Campaign,
  type StartPledgeCheckoutInput
} from '$lib/server/domain/campaigns';
import {
  expireCheckout,
  SettlementError,
  settleCheckout,
  type CreateCheckoutSessionInput,
  type PaymentGateway
} from '$lib/server/domain/payments';
import { createOrganization } from '$lib/server/domain/orgs';

describe('campaign pledge money rail', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let participantId: string;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'campaign-payment-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    [ownerId, participantId] = await Promise.all([
      createUser('campaign-payment-owner', 'Campaign Payment Owner'),
      createUser('campaign-payment-participant', 'Campaign Payment Participant')
    ]);
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  it('starts guest and authenticated pledges with immutable snapshots and bearer tokens', async () => {
    const guestFixture = await openCampaign('Guest start');
    const guestGateway = new RecordingGateway();
    const guest = await startPledgeCheckout(
      client,
      guestGateway,
      checkoutInput(guestFixture.campaign, {
        displayName: '  Guest Supporter  ',
        listPublicly: false,
        unitCount: 3,
        successUrl: `https://example.test/pledges/${pledgeAccessTokenPlaceholder}?payment=success`,
        cancelUrl: `https://example.test/pledges/${pledgeAccessTokenPlaceholder}?payment=cancelled`
      })
    );
    expect(guest.accessToken).toMatch(/^[0-9a-f]{64}$/);
    expect(guest.checkoutUrl).toContain('https://checkout.stripe.test/');
    const guestOrder = await orderByToken(guest.accessToken);
    expect(guestOrder).toMatchObject({
      campaignId: guestFixture.campaign.id,
      userId: null,
      displayName: 'Guest Supporter',
      listPublicly: false,
      unitCount: 3,
      unitPriceMinor: 1_000n,
      amountMinor: 3_000n,
      currency: 'JPY',
      status: 'payment_pending',
      stripeAccountId: guestFixture.stripeAccountId,
      checkoutSessionId: `cs_test_${guestOrder.id}`,
      paymentIntentId: `pi_test_${guestOrder.id}`
    });
    expect(guestGateway.inputs[0]).toMatchObject({
      referenceId: guestOrder.id,
      productName: guestFixture.campaign.title,
      amountMinor: 1_000n,
      currency: 'JPY',
      quantity: 3,
      stripeAccountId: guestFixture.stripeAccountId,
      idempotencyKey: `pledge-${guestOrder.id}`,
      expireAfter: 3_600_000
    });
    expect(guestGateway.inputs[0].successUrl).toContain(guest.accessToken);
    expect(guestGateway.inputs[0].cancelUrl).toContain(guest.accessToken);

    const authenticatedFixture = await openCampaign('Authenticated start');
    const authenticated = await startPledgeCheckout(
      client,
      new RecordingGateway(),
      checkoutInput(authenticatedFixture.campaign, {
        userId: participantId,
        displayName: 'Signed-in Supporter',
        listPublicly: true
      })
    );
    expect(await orderByToken(authenticated.accessToken)).toMatchObject({
      userId: participantId,
      listPublicly: true,
      status: 'payment_pending'
    });
  });

  it('refuses closed and suspended campaigns before calling Checkout', async () => {
    const closedFixture = await openCampaign('Closed refusal');
    await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: closedFixture.campaign.id,
      status: 'closed'
    });
    const closedGateway = new RecordingGateway();
    await expect(
      startPledgeCheckout(client, closedGateway, checkoutInput(closedFixture.campaign))
    ).rejects.toMatchObject({ code: 'not_payable' } satisfies Partial<CampaignError>);
    expect(closedGateway.inputs).toHaveLength(0);

    const suspendedFixture = await openCampaign('Suspended refusal');
    await client.db
      .update(organizations)
      .set({ suspendedAt: new Date() })
      .where(eq(organizations.id, suspendedFixture.organizationId));
    const suspendedGateway = new RecordingGateway();
    await expect(
      startPledgeCheckout(client, suspendedGateway, checkoutInput(suspendedFixture.campaign))
    ).rejects.toMatchObject({ code: 'not_payable' } satisfies Partial<CampaignError>);
    expect(suspendedGateway.inputs).toHaveLength(0);
  });

  it('refuses a Connect account that is not ready for charges', async () => {
    const fixture = await openCampaign('Connect refusal', false);
    const gateway = new RecordingGateway();
    await expect(
      startPledgeCheckout(client, gateway, checkoutInput(fixture.campaign))
    ).rejects.toMatchObject({ code: 'not_ready' } satisfies Partial<CampaignError>);
    expect(gateway.inputs).toHaveLength(0);
  });

  it('validates unit, display-name, and consent bounds before creating an order', async () => {
    const fixture = await openCampaign('Bounds refusal');
    const invalidInputs: StartPledgeCheckoutInput[] = [
      checkoutInput(fixture.campaign, { unitCount: 0 }),
      checkoutInput(fixture.campaign, { unitCount: 11 }),
      checkoutInput(fixture.campaign, { unitCount: 1.5 }),
      checkoutInput(fixture.campaign, { displayName: '   ' }),
      checkoutInput(fixture.campaign, { displayName: 'x'.repeat(65) }),
      { ...checkoutInput(fixture.campaign), listPublicly: 'true' as unknown as boolean }
    ];
    const gateway = new RecordingGateway();
    for (const input of invalidInputs) {
      await expect(startPledgeCheckout(client, gateway, input)).rejects.toMatchObject({
        code: 'validation'
      } satisfies Partial<CampaignError>);
    }
    expect(gateway.inputs).toHaveLength(0);
    expect(await campaignOrderCount(fixture.campaign.id)).toBe(0);
  });

  it('leaves a harmless pending order when Checkout creation fails', async () => {
    const fixture = await openCampaign('Gateway failure');
    const gateway = new RecordingGateway(true);
    await expect(
      startPledgeCheckout(client, gateway, checkoutInput(fixture.campaign))
    ).rejects.toMatchObject({ code: 'gateway' } satisfies Partial<CampaignError>);
    const rows = await client.db
      .select()
      .from(orders)
      .where(eq(orders.campaignId, fixture.campaign.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      stripeAccountId: '',
      checkoutSessionId: '',
      paymentIntentId: ''
    });
  });

  it('settles an order once and deduplicates a repeated webhook delivery', async () => {
    const fixture = await startedPledge('Settle duplicate');
    const input = settlementInput(fixture, 'evt_pledge_duplicate');
    const first = await settleCheckout(client, input);
    const duplicate = await settleCheckout(client, input);

    expect(first).toMatchObject({
      alreadyProcessed: false,
      ignoredUnpaid: false,
      conflict: false,
      kind: 'order',
      record: null
    });
    expect(first.order).toMatchObject({ id: fixture.order.id, status: 'paid' });
    expect(duplicate).toMatchObject({ alreadyProcessed: true, kind: 'order' });
    expect(await orderById(fixture.order.id)).toMatchObject({ status: 'paid' });
    expect(await auditCount(fixture.order.id, 'campaign.pledge_settle')).toBe(1);
    expect(await webhookCount('evt_pledge_duplicate')).toBe(1);
  });

  it('rejects account and amount mismatches without consuming either event', async () => {
    const fixture = await startedPledge('Settle mismatch');
    await expect(
      settleCheckout(client, {
        ...settlementInput(fixture, 'evt_pledge_wrong_account'),
        stripeAccountId: 'acct_wrong'
      })
    ).rejects.toMatchObject({ code: 'account_mismatch' } satisfies Partial<SettlementError>);
    await expect(
      settleCheckout(client, {
        ...settlementInput(fixture, 'evt_pledge_wrong_amount'),
        amountTotal: fixture.order.amountMinor + 1n
      })
    ).rejects.toMatchObject({ code: 'amount_mismatch' } satisfies Partial<SettlementError>);
    expect(await orderById(fixture.order.id)).toMatchObject({ status: 'payment_pending' });
    expect(await webhookCount('evt_pledge_wrong_account')).toBe(0);
    expect(await webhookCount('evt_pledge_wrong_amount')).toBe(0);
  });

  it('preserves an expired status as a paid-after-expiry conflict', async () => {
    const fixture = await startedPledge('Expire conflict');
    await expireCheckout(client, expirationInput(fixture, 'evt_pledge_expire_before_pay'));
    const result = await settleCheckout(
      client,
      settlementInput(fixture, 'evt_pledge_paid_after_expire')
    );

    expect(result).toMatchObject({ conflict: true, kind: 'order' });
    expect(result.order).toMatchObject({ status: 'expired' });
    expect(result.order?.paidAt).not.toBeNull();
    expect(await auditCount(fixture.order.id, 'campaign.stripe_settle_conflict')).toBe(1);
  });

  it('settles normally after the campaign closes', async () => {
    const fixture = await startedPledge('Closed settle');
    await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: fixture.campaign.id,
      status: 'closed'
    });
    const result = await settleCheckout(client, settlementInput(fixture, 'evt_closed_settle'));
    expect(result).toMatchObject({ conflict: false, kind: 'order' });
    expect(result.order).toMatchObject({ status: 'paid' });
    expect(await auditCount(fixture.order.id, 'campaign.stripe_settle_conflict')).toBe(0);
  });

  it('expires a payment-pending order exactly once', async () => {
    const fixture = await startedPledge('Expire once');
    const input = expirationInput(fixture, 'evt_expire_once');
    const first = await expireCheckout(client, input);
    const duplicate = await expireCheckout(client, input);

    expect(first).toMatchObject({
      alreadyProcessed: false,
      expired: true,
      kind: 'order'
    });
    expect(first.order).toMatchObject({ status: 'expired' });
    expect(duplicate).toMatchObject({ alreadyProcessed: true, expired: false, kind: 'order' });
    expect(await auditCount(fixture.order.id, 'campaign.pledge_expire')).toBe(1);
    expect(await webhookCount('evt_expire_once')).toBe(1);
  });

  it('serializes concurrent settlements so exactly one transition wins', async () => {
    const fixture = await startedPledge('Settle race');
    const [first, second] = await Promise.all([
      settleCheckout(client, settlementInput(fixture, 'evt_pledge_race_one')),
      settleCheckout(client, settlementInput(fixture, 'evt_pledge_race_two'))
    ]);

    expect([first, second].filter(({ alreadyProcessed }) => !alreadyProcessed)).toHaveLength(1);
    expect([first, second].filter(({ alreadyProcessed }) => alreadyProcessed)).toHaveLength(1);
    expect(await orderById(fixture.order.id)).toMatchObject({ status: 'paid' });
    expect(await auditCount(fixture.order.id, 'campaign.pledge_settle')).toBe(1);
  });

  async function openCampaign(prefix: string, connectReady = true) {
    sequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `${prefix} ${sequence}`
    });
    const campaign = await createCampaign(client, {
      actorUserId: ownerId,
      organizationId: organization.id,
      title: `${prefix} Campaign`,
      slug: `campaign-payment-${sequence}`,
      description: '',
      unitPriceMinor: 1_000n,
      currency: 'JPY',
      goalMinor: 10_000n,
      maxUnitsPerPledge: 10,
      fulfillmentDate: null,
      fulfillmentNote: '',
      contact: 'organizer@example.test'
    });
    const opened = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: campaign.id,
      status: 'open'
    });
    const stripeAccountId = `acct_campaign_payment_${sequence}`;
    await client.db.insert(stripeConnectAccounts).values({
      organizationId: organization.id,
      stripeAccountId,
      dashboardType: 'express',
      chargesEnabled: connectReady,
      payoutsEnabled: connectReady,
      detailsSubmitted: connectReady,
      onboardingStatus: connectReady ? 'ready' : 'onboarding_required',
      country: 'JP',
      defaultCurrency: 'jpy'
    });
    return { campaign: opened, organizationId: organization.id, stripeAccountId };
  }

  async function startedPledge(prefix: string) {
    const fixture = await openCampaign(prefix);
    const gateway = new RecordingGateway();
    const result = await startPledgeCheckout(
      client,
      gateway,
      checkoutInput(fixture.campaign, { unitCount: 2 })
    );
    return {
      ...fixture,
      gateway,
      order: await orderByToken(result.accessToken)
    };
  }

  function checkoutInput(
    campaign: Campaign,
    overrides: Partial<StartPledgeCheckoutInput> = {}
  ): StartPledgeCheckoutInput {
    return {
      campaignId: campaign.id,
      userId: null,
      displayName: 'Campaign Supporter',
      listPublicly: false,
      unitCount: 1,
      successUrl: 'https://example.test/pledges/success',
      cancelUrl: 'https://example.test/pledges/cancel',
      ...overrides
    };
  }

  function settlementInput(
    fixture: Awaited<ReturnType<typeof startedPledge>>,
    stripeEventId: string
  ) {
    return {
      stripeEventId,
      eventType: 'checkout.session.completed',
      sessionId: fixture.order.checkoutSessionId,
      paymentIntentId: fixture.order.paymentIntentId,
      paymentStatus: 'paid',
      amountTotal: fixture.order.amountMinor,
      currency: fixture.order.currency,
      stripeAccountId: fixture.order.stripeAccountId,
      raw: { id: stripeEventId, type: 'checkout.session.completed' }
    };
  }

  function expirationInput(
    fixture: Awaited<ReturnType<typeof startedPledge>>,
    stripeEventId: string
  ) {
    return {
      stripeEventId,
      eventType: 'checkout.session.expired',
      sessionId: fixture.order.checkoutSessionId,
      stripeAccountId: fixture.order.stripeAccountId,
      raw: { id: stripeEventId, type: 'checkout.session.expired' }
    };
  }

  async function createUser(providerUserId: string, displayName: string): Promise<string> {
    return (
      await upsertDiscordIdentity(client, {
        providerUserId,
        username: providerUserId,
        displayName,
        avatarUrl: ''
      })
    ).userId;
  }

  async function orderByToken(accessToken: string) {
    const rows = await client.db.select().from(orders).where(eq(orders.accessToken, accessToken));
    return rows[0];
  }

  async function orderById(orderId: string) {
    const rows = await client.db.select().from(orders).where(eq(orders.id, orderId));
    return rows[0];
  }

  async function campaignOrderCount(campaignId: string) {
    const rows = await client.db
      .select({ value: count(orders.id) })
      .from(orders)
      .where(eq(orders.campaignId, campaignId));
    return rows[0].value;
  }

  async function auditCount(orderId: string, action: string) {
    const rows = await client.db
      .select({ value: count(auditLogs.id) })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'order'),
          eq(auditLogs.targetId, orderId),
          eq(auditLogs.action, action)
        )
      );
    return rows[0].value;
  }

  async function webhookCount(stripeEventId: string) {
    const rows = await client.db
      .select({ value: count(stripeWebhookEvents.id) })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
    return rows[0].value;
  }
});

class RecordingGateway implements PaymentGateway {
  readonly inputs: CreateCheckoutSessionInput[] = [];

  constructor(private readonly fail = false) {}

  createCheckoutSession(input: CreateCheckoutSessionInput) {
    this.inputs.push(input);
    if (this.fail) return Promise.reject(new Error('test gateway failure'));
    return Promise.resolve({
      sessionId: `cs_test_${input.referenceId}`,
      paymentIntentId: `pi_test_${input.referenceId}`,
      url: `https://checkout.stripe.test/${input.referenceId}`
    });
  }
}
