import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
import {
  paymentRecords,
  paymentRequests,
  organizations,
  stripeConnectAccounts,
  stripeWebhookEvents
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { createEvent, publishEvent, updateSettings } from '$lib/server/domain/events';
import { createOrganization } from '$lib/server/domain/orgs';
import { listPlatformPaymentConflicts } from '$lib/server/domain/platform';
import {
  createCollection,
  getCollectionDashboard,
  markConflictRefunded,
  openCollection,
  SettlementError,
  settleCheckout,
  startCheckout,
  type PaymentGateway
} from '$lib/server/domain/payments';
import { changeRegistrationStatus, createRegistration } from '$lib/server/domain/registrations';

describe('Stripe checkout settlement', () => {
  let client: DatabaseClient;
  let ownerId: string;
  let sequence = 0;
  beforeEach(async () => {
    client = testDatabase();
    ownerId = await createUser('stripe-payment-owner', 'Stripe Payment Owner');
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });

  it('records checkout intent before Stripe and restores pending status if Stripe fails', async () => {
    const fixture = await paymentFixture();
    const gateway: PaymentGateway = {
      async createCheckoutSession() {
        expect(client.db.$client.inTransaction).toBe(false);
        expect((await request(fixture.requestId)).status).toBe('payment_pending');
        await Promise.resolve();
        throw new Error('Stripe unavailable');
      }
    };
    await expect(
      startCheckout(
        client,
        gateway,
        {
          userId: fixture.participantUserId,
          registrationId: fixture.registrationId,
          successUrl: 'https://example.test/success',
          cancelUrl: 'https://example.test/cancel'
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'gateway' });
    expect(await request(fixture.requestId)).toMatchObject({
      status: 'pending',
      checkoutSessionId: '',
      stripeAccountId: ''
    });
  });

  it('deduplicates the same Stripe event into one settled record', async () => {
    const fixture = await checkoutFixture();
    const input = settlementInput(fixture, 'evt_duplicate');
    const first = await settleCheckout(client, input, fixedClock);
    const duplicate = await settleCheckout(client, input, fixedClock);
    expect(first).toMatchObject({
      alreadyProcessed: false,
      conflict: false,
      kind: 'payment_request'
    });
    expect(duplicate).toMatchObject({
      alreadyProcessed: true,
      kind: 'payment_request',
      record: null
    });
    expect(await recordCount(fixture.requestId, 'settled')).toBe(1);
    expect(await webhookCount('evt_duplicate')).toBe(1);
    expect((await request(fixture.requestId)).status).toBe('paid');
  });
  it('rejects wrong connected accounts and amounts without consuming the event', async () => {
    const fixture = await checkoutFixture();
    await expect(
      settleCheckout(
        client,
        {
          ...settlementInput(fixture, 'evt_wrong_account'),
          stripeAccountId: 'acct_someone_else'
        },
        fixedClock
      )
    ).rejects.toMatchObject({
      code: 'account_mismatch'
    } satisfies Partial<SettlementError>);
    await expect(
      settleCheckout(
        client,
        {
          ...settlementInput(fixture, 'evt_wrong_amount'),
          amountTotal: fixture.amountMinor + 1n
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'amount_mismatch' } satisfies Partial<SettlementError>);
    expect(await webhookCount('evt_wrong_account')).toBe(0);
    expect(await webhookCount('evt_wrong_amount')).toBe(0);
    expect(await recordCount(fixture.requestId, 'settled')).toBe(0);
    expect((await request(fixture.requestId)).status).toBe('payment_pending');
  });
  it('settles async payment success for a payment-pending request', async () => {
    const fixture = await checkoutFixture();
    const result = await settleCheckout(
      client,
      {
        ...settlementInput(fixture, 'evt_async_success'),
        eventType: 'checkout.session.async_payment_succeeded'
      },
      fixedClock
    );
    expect(result).toMatchObject({
      alreadyProcessed: false,
      ignoredUnpaid: false,
      conflict: false
    });
    expect((await request(fixture.requestId)).status).toBe('paid');
    expect(await recordCount(fixture.requestId, 'settled')).toBe(1);
  });
  it('refuses checkout before calling Stripe when the organization is suspended', async () => {
    const fixture = await paymentFixture();
    client.db
      .update(organizations)
      .set({ suspendedAt: new Date('2026-10-21T00:00:00.000Z') })
      .where(eq(organizations.id, fixture.organizationId))
      .run();
    const gateway = new StableGateway();
    await expect(
      startCheckout(
        client,
        gateway,
        {
          userId: fixture.participantUserId,
          registrationId: fixture.registrationId,
          successUrl: 'https://example.test/success',
          cancelUrl: 'https://example.test/cancel'
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'not_payable' });
  });
  it('surfaces cancelled-then-paid money and marks it refunded exactly once', async () => {
    const fixture = await checkoutFixture();
    await changeRegistrationStatus(
      client,
      {
        actorUserId: ownerId,
        registrationId: fixture.registrationId,
        status: 'cancelled'
      },
      fixedClock
    );
    const settlement = await settleCheckout(
      client,
      settlementInput(fixture, 'evt_cancelled_then_paid'),
      fixedClock
    );
    expect(settlement).toMatchObject({ conflict: true, alreadyProcessed: false });
    expect((await request(fixture.requestId)).status).toBe('cancelled');
    expect((await getCollectionDashboard(client, fixture)).conflicts).toHaveLength(1);
    expect(await listPlatformPaymentConflicts(client)).toContainEqual(
      expect.objectContaining({
        recordId: settlement.record!.id,
        organizationId: fixture.organizationId,
        eventId: fixture.eventId,
        paymentRequestId: fixture.requestId
      })
    );
    const command = {
      actorUserId: ownerId,
      eventId: fixture.eventId,
      paymentRecordId: settlement.record!.id,
      note: 'Refunded through the Stripe dashboard.'
    };
    const first = await markConflictRefunded(client, command, fixedClock);
    const duplicate = await markConflictRefunded(client, command, fixedClock);
    expect(duplicate.id).toBe(first.id);
    expect(first).toMatchObject({
      paymentRequestId: fixture.requestId,
      amountMinor: fixture.amountMinor,
      currency: 'JPY',
      status: 'refunded',
      idempotencyKey: `manual_refund:${settlement.record!.id}`
    });
    expect(await recordCount(fixture.requestId, 'refunded')).toBe(1);
    expect((await getCollectionDashboard(client, fixture)).conflicts).toHaveLength(0);
    expect(await listPlatformPaymentConflicts(client)).not.toContainEqual(
      expect.objectContaining({ recordId: settlement.record!.id })
    );
  });
  it('attaches one idempotent Checkout Session when starts race', async () => {
    const fixture = await paymentFixture();
    const gateway = new RacingGateway(fixture.requestId);
    const input = {
      userId: fixture.participantUserId,
      registrationId: fixture.registrationId,
      successUrl: `https://example.test/registrations/${fixture.registrationId}?payment=success`,
      cancelUrl: `https://example.test/registrations/${fixture.registrationId}?payment=cancelled`
    };
    const [first, second] = await Promise.all([
      startCheckout(client, gateway, input, fixedClock),
      startCheckout(client, gateway, input, fixedClock)
    ]);
    expect(first).toBe(second);
    expect(gateway.calls).toBe(2);
    expect(await request(fixture.requestId)).toMatchObject({
      status: 'payment_pending',
      checkoutSessionId: `cs_test_${fixture.requestId}`,
      paymentIntentId: `pi_test_${fixture.requestId}`,
      stripeAccountId: fixture.stripeAccountId,
      chargeType: 'direct'
    });
  });
  async function checkoutFixture() {
    const fixture = await paymentFixture();
    await startCheckout(
      client,
      new StableGateway(),
      {
        userId: fixture.participantUserId,
        registrationId: fixture.registrationId,
        successUrl: `https://example.test/registrations/${fixture.registrationId}?payment=success`,
        cancelUrl: `https://example.test/registrations/${fixture.registrationId}?payment=cancelled`
      },
      fixedClock
    );
    return fixture;
  }
  async function paymentFixture() {
    sequence += 1;
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: `Stripe Payment Group ${sequence}`
      },
      fixedClock
    );
    const event = await createEvent(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: `Stripe Payment Event ${sequence}`,
        startsAt: '2027-11-01T18:00',
        capacity: null,
        registrationMode: 'auto_confirm',
        timeZone: 'Asia/Tokyo'
      },
      () => `stripe-payment-event-${sequence}`,
      fixedClock
    );
    await updateSettings(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        title: event.title,
        description: '',
        startsAt: '2027-11-01T18:00',
        endsAt: '2027-11-01T21:00',
        capacity: null,
        venueName: '',
        venueAddress: '',
        venueReveal: 'public',
        contact: '',
        cancellationPolicy: '',
        registrationOpensAt: '2026-01-01T00:00',
        registrationClosesAt: '2027-11-01T17:00',
        registrationMode: 'auto_confirm',
        discordPolicy: 'not_used',
        timeZone: 'Asia/Tokyo'
      },
      fixedClock
    );
    const published = await publishEvent(
      client,
      { actorUserId: ownerId, eventId: event.id },
      fixedClock
    );
    const stripeAccountId = `acct_integration_${sequence}`;
    client.db
      .insert(stripeConnectAccounts)
      .values({
        createdAt: fixedClock.now(),
        updatedAt: fixedClock.now(),
        organizationId: organization.id,
        stripeAccountId,
        dashboardType: 'express',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        onboardingStatus: 'ready',
        country: 'JP',
        defaultCurrency: 'jpy'
      })
      .run();
    const collection = await createCollection(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        title: 'Participation fee',
        amountMinor: 5000n,
        currency: 'JPY',
        dueAt: new Date('2027-10-20T15:00:00Z'),
        instructions: ''
      },
      fixedClock
    );
    await openCollection(client, { actorUserId: ownerId, eventId: event.id }, fixedClock);
    const displayName = `Stripe Participant ${sequence}`;
    const participantUserId = await createUser(`stripe-participant-${sequence}`, displayName);
    const registration = await createRegistration(
      client,
      {
        organizationSlug: organization.slug,
        eventSlug: published.slug,
        userId: participantUserId,
        displayName,
        answers: []
      },
      fixedClock
    );
    const requests = client.db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.collectionId, collection.id))
      .all();
    return {
      actorUserId: ownerId,
      organizationId: organization.id,
      eventId: event.id,
      requestId: requests[0].id,
      registrationId: registration.id,
      participantUserId,
      stripeAccountId,
      amountMinor: collection.amountMinor,
      currency: collection.currency,
      sessionId: `cs_test_${requests[0].id}`
    };
  }
  function settlementInput(
    fixture: Awaited<ReturnType<typeof paymentFixture>>,
    stripeEventId: string
  ) {
    return {
      stripeEventId,
      eventType: 'checkout.session.completed',
      sessionId: fixture.sessionId,
      paymentIntentId: `pi_test_${fixture.requestId}`,
      paymentStatus: 'paid',
      amountTotal: fixture.amountMinor,
      currency: fixture.currency,
      stripeAccountId: fixture.stripeAccountId,
      raw: { id: stripeEventId, type: 'checkout.session.completed' }
    };
  }
  async function createUser(providerUserId: string, displayName: string): Promise<string> {
    return (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId,
          username: providerUserId,
          displayName,
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
  }
  async function request(requestId: string) {
    const rows = client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, requestId))
      .all();
    return rows[0];
  }
  async function recordCount(requestId: string, status: 'settled' | 'refunded') {
    const rows = client.db
      .select({ value: count(paymentRecords.id) })
      .from(paymentRecords)
      .where(and(eq(paymentRecords.paymentRequestId, requestId), eq(paymentRecords.status, status)))
      .all();
    return rows[0].value;
  }
  async function webhookCount(stripeEventId: string) {
    const rows = client.db
      .select({ value: count(stripeWebhookEvents.id) })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId))
      .all();
    return rows[0].value;
  }
});

class StableGateway implements PaymentGateway {
  createCheckoutSession(input: Parameters<PaymentGateway['createCheckoutSession']>[0]) {
    return Promise.resolve({
      sessionId: `cs_test_${input.referenceId}`,
      paymentIntentId: `pi_test_${input.referenceId}`,
      url: `https://checkout.stripe.test/${input.referenceId}`
    });
  }
}

class RacingGateway implements PaymentGateway {
  calls = 0;
  private release!: () => void;
  private readonly bothCalled = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  constructor(private readonly requestId: string) {}
  async createCheckoutSession() {
    this.calls += 1;
    if (this.calls === 2) this.release();
    await this.bothCalled;
    return {
      sessionId: `cs_test_${this.requestId}`,
      paymentIntentId: `pi_test_${this.requestId}`,
      url: `https://checkout.stripe.test/${this.requestId}`
    };
  }
}
