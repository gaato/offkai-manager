import { actions as paymentActions } from '../../src/routes/app/events/[eventId]/payments/+page.server';
import { translator } from '$lib/i18n';
import Stripe from 'stripe';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getConfig, resetConfigForTests, defaultTuning } from '$lib/server/config';
import { getDatabaseClient, closeDatabase, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  stripeConnectAccounts,
  registrations,
  paymentRequests,
  notificationDeliveries,
  eventDiscordIntegrations,
  discordPanels,
  outboxEvents,
  collectionPaymentMethods
} from '$lib/server/db/schema';
import { StripeWebhookVerifier } from '$lib/server/gateways/stripe/webhook';
import { StripeV2WebhookVerifier } from '$lib/server/gateways/stripe/v2-webhook';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import { processRoleSyncBatch } from '$lib/server/worker/role-sync';
import { tickOnce } from '$lib/server/domain/payments/holds';
import * as appModule from '$lib/server/app';
import * as restModule from '$lib/server/interactions/rest';
import { getLogger } from '$lib/server/logger';
import { POST as snapshotPost } from '../../src/routes/webhooks/stripe/+server';
import { POST as thinPost } from '../../src/routes/webhooks/stripe/v2/+server';
import { paidEvent, GatedCheckout } from '../support/paid-event';
import { makeComponent, callInteraction } from '../support/interactions';
import { recordingRest, responseLike } from '../support/discord-rest';
import { signingKey } from '../support/scenario-setup';
import { fixedClock } from '../database';
import type { ConnectGateway } from '$lib/server/domain/payments/gateway';
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
let client: DatabaseClient;
let gateway: GatedCheckout;
const secret = 'whsec_snapshot_fake';
const thinSecret = 'whsec_thin_fake';
const connect: ConnectGateway = {
  async createAccount() {
    return { accountId: 'acct_paid' };
  },
  async createAccountLink() {
    return { url: 'https://stripe.test/onboard' };
  },
  async getAccount() {
    return {
      chargesEnabled: true,
      detailsSubmitted: true,
      payoutsEnabled: true,
      dashboardType: 'none',
      country: 'JP',
      defaultCurrency: 'jpy'
    };
  }
};
beforeEach(() => {
  vi.stubEnv('OFFKAI_DISCORD_BOT_TOKEN', 'fake-test-token');
  resetConfigForTests();
  client = getDatabaseClient(getConfig());
  runMigrations(client);
  fixedClock.advance(0);
  gateway = new GatedCheckout();
  gateway.resume();
  vi.spyOn(appModule, 'getApp').mockReturnValue({
    stripe: { mode: 'real', connect, payment: gateway, webhook: new StripeWebhookVerifier(secret) }
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase(client);
  vi.stubEnv('OFFKAI_DISCORD_BOT_TOKEN', undefined);
  resetConfigForTests();
});
function participant(eventId: string) {
  const interaction = makeComponent(`om1:join:${eventId}`);
  interaction.member!.user = { ...interaction.member!.user, id: '200000000000000002' };
  return interaction;
}
async function webhook(
  route: typeof snapshotPost | typeof thinPost,
  payload: object,
  signingSecret: string
) {
  const body = JSON.stringify(payload);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: signingSecret
  });
  return route({
    request: new Request('https://example.test/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body
    }),
    locals: { logger: getLogger(getConfig()) }
  } as Parameters<typeof snapshotPost>[0] & Parameters<typeof thinPost>[0]);
}
it.each([false, true])(
  'signed paid Discord join → Checkout → webhook → role + notification (DM blocked=%s)',
  async (blocked) => {
    const fixture = await paidEvent(client);
    client.db
      .update(eventDiscordIntegrations)
      .set({ notificationChannelId: '500000000000000009' })
      .where(eq(eventDiscordIntegrations.eventId, fixture.event.id))
      .run();
    const transport = recordingRest((call) =>
      call.url.endsWith('/users/@me/channels') && blocked
        ? responseLike({ code: 50007, message: 'Cannot send messages to this user' }, 403)
        : responseLike({ id: '800000000000000007' })
    );
    vi.spyOn(restModule, 'getInteractionRest').mockReturnValue(transport.rest);
    const response = await callInteraction(participant(fixture.event.id), signingKey.privateKey);
    expect(await response.json()).toMatchObject({ type: 5, data: { flags: 64 } });
    await vi.waitFor(() =>
      expect(
        transport.calls.some((call) =>
          JSON.stringify(call.body).includes('https://checkout.stripe.test/cs_gated')
        )
      ).toBe(true)
    );
    expect(client.db.select().from(registrations).get()?.status).toBe('held');
    const session = gateway.settlement();
    const payload = {
      id: 'evt_scenario_paid',
      object: 'event',
      type: 'checkout.session.completed',
      account: 'acct_paid',
      data: {
        object: {
          id: session.sessionId,
          client_reference_id: session.referenceId,
          payment_status: 'paid',
          amount_total: Number(session.amountTotal),
          currency: 'jpy',
          payment_intent: 'pi_gated'
        }
      }
    };
    expect((await webhook(snapshotPost, payload, secret)).status).toBe(200);
    await processRoleSyncBatch(
      client,
      createDiscordGateway('fake-test-token', { rest: transport.rest }),
      undefined,
      fixedClock,
      { ...defaultTuning, OFFKAI_NOTIFICATION_DM_INTERVAL_MS: 0 },
      transport.rest
    );
    expect(client.db.select().from(registrations).get()?.status).toBe('confirmed');
    expect(client.db.select().from(paymentRequests).get()?.status).toBe('paid');
    expect(
      transport.calls.some((call) => call.method === 'PUT' && call.url.includes('/roles/'))
    ).toBe(true);
    expect(
      client.db
        .select()
        .from(notificationDeliveries)
        .all()
        .some((delivery) => delivery.result === 'sent')
    ).toBe(true);
    if (blocked) {
      expect(transport.calls.find((call) => call.url.endsWith('/threads'))?.body).toMatchObject({
        type: 12,
        invitable: false
      });
      expect(
        transport.calls.some(
          (call) => call.method === 'PUT' && call.url.endsWith('/thread-members/200000000000000002')
        )
      ).toBe(true);
      const sent = transport.calls.find(
        (call) =>
          call.url.includes('/messages') &&
          JSON.stringify(call.body).includes('<@200000000000000002>')
      );
      expect(sent?.body).toMatchObject({
        allowed_mentions: { parse: [], users: ['200000000000000002'] }
      });
    }
  }
);
it('hold expiry releases a seat and delivers notification while refreshing the panel', async () => {
  const fixture = await paidEvent(client);
  const registration = await fixture.join();
  client.db
    .insert(discordPanels)
    .values({
      eventId: fixture.event.id,
      guildId: '400000000000000001',
      channelId: '500000000000000001',
      messageId: '800000000000000001',
      locale: 'en'
    })
    .run();
  fixedClock.advance(registration.holdExpiresAt!.getTime() - fixedClock.now().getTime());
  tickOnce(client, fixedClock.now());
  const transport = recordingRest();
  await processRoleSyncBatch(
    client,
    createDiscordGateway('fake-test-token', { rest: transport.rest }),
    undefined,
    fixedClock,
    defaultTuning,
    transport.rest
  );
  expect(client.db.select().from(registrations).get()?.status).toBe('cancelled');
  expect(
    transport.calls.some((call) => call.method === 'PATCH' && call.url.includes('/messages/'))
  ).toBe(true);
  expect(client.db.select().from(notificationDeliveries).get()).toMatchObject({
    kind: 'hold_expired',
    result: 'sent'
  });
  expect(
    client.db
      .select()
      .from(outboxEvents)
      .all()
      .every((row) => row.status === 'processed')
  ).toBe(true);
});
it('verifies a signed thin event, fetches the related object, and refreshes readiness', async () => {
  const fixture = await paidEvent(client);
  client.db
    .update(stripeConnectAccounts)
    .set({ chargesEnabled: false, onboardingStatus: 'onboarding_required' })
    .where(eq(stripeConnectAccounts.organizationId, fixture.org.id))
    .run();
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ id: 'acct_paid', object: 'v2.core.account' }), {
        headers: { 'content-type': 'application/json' }
      })
  );
  const sdk = new Stripe('sk_test_fake', {
    httpClient: Stripe.createFetchHttpClient(fetcher),
    maxNetworkRetries: 0
  });
  const verifier = new StripeV2WebhookVerifier('sk_test_fake', thinSecret, connect, sdk);
  vi.mocked(appModule.getApp).mockReturnValue({
    stripe: { mode: 'real', connect, payment: gateway, webhook: null, v2Webhook: verifier }
  });
  const payload = {
    id: 'evt_thin',
    object: 'v2.core.event',
    type: 'v2.core.account[configuration.merchant].capability_status_updated',
    related_object: { id: 'acct_paid', type: 'v2.core.account', url: '/v2/core/accounts/acct_paid' }
  };
  expect((await webhook(thinPost, payload, thinSecret)).status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(client.db.select().from(stripeConnectAccounts).get()?.onboardingStatus).toBe('ready');
  expect((await webhook(thinPost, payload, secret)).status).toBe(400);
});

it('pay-later Discord join confirms unpaid, then an organizer web action records cash', async () => {
  const fixture = await paidEvent(client, 'pay_later');
  const transport = recordingRest();
  vi.spyOn(restModule, 'getInteractionRest').mockReturnValue(transport.rest);
  await callInteraction(participant(fixture.event.id), signingKey.privateKey);
  await vi.waitFor(() => expect(gateway.calls).toBe(1));
  expect(client.db.select().from(registrations).get()?.status).toBe('confirmed');
  const request = client.db.select().from(paymentRequests).get()!;
  expect(request.status).toBe('payment_pending');
  const method = client.db
    .select()
    .from(collectionPaymentMethods)
    .where(eq(collectionPaymentMethods.label, 'payments.default_method.cash.label'))
    .get()!;
  const body = new URLSearchParams({
    requestId: request.id,
    methodId: method.id,
    idempotencyKey: 'scenario-web-cash',
    externalReference: '',
    note: ''
  });
  const result = await paymentActions.confirmManual({
    request: new Request(
      `https://example.test/app/events/${fixture.event.id}/payments?/confirmManual`,
      { method: 'POST', body }
    ),
    url: new URL(`https://example.test/app/events/${fixture.event.id}/payments`),
    params: { eventId: fixture.event.id },
    locals: {
      session: {
        userId: fixture.owner.userId,
        displayName: 'Owner',
        platformAdmin: false,
        issuedAt: 0,
        expiresAt: 9999999999
      },
      t: translator('en'),
      logger: getLogger(getConfig())
    }
  } as Parameters<typeof paymentActions.confirmManual>[0]);
  expect(result).toHaveProperty('actionMessage');
  expect(client.db.select().from(paymentRequests).get()?.status).toBe('paid');
});
