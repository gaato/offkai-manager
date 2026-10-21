import Stripe from 'stripe';
import { expect, it, vi } from 'vitest';
import { RealConnectGateway } from '$lib/server/gateways/stripe/real';
import { requireReadyConnectedAccount } from '$lib/server/domain/payments/gateway';
const createHarness = () => {
  const calls: { url: string; body: string; headers: Headers }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    calls.push({
      url: String(url),
      body: String(init?.body ?? ''),
      headers: new Headers(init?.headers)
    });
    return new Response(
      JSON.stringify({
        id: 'acct_v2',
        url: 'https://stripe.test/link',
        client_secret: 'fake_session',
        configuration: { merchant: { capabilities: { card_payments: { status: 'active' } } } },
        identity: { country: 'jp' },
        defaults: { currency: 'jpy' }
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  });
  const client = new Stripe('sk_test_fake', {
    httpClient: Stripe.createFetchHttpClient(fetcher),
    maxNetworkRetries: 0
  });
  return { calls, gateway: new RealConnectGateway('sk_test_fake', client) };
};
it('creates Managed Risk JP individual v2 accounts and v2 hosted links without configurations', async () => {
  const { gateway, calls } = createHarness();
  await gateway.createAccount({ organizationId: 'org' });
  expect(calls[0].url).toContain('/v2/core/accounts');
  expect(JSON.parse(calls[0].body)).toMatchObject({
    identity: { country: 'jp', entity_type: 'individual' },
    dashboard: 'none',
    defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } }
  });
  expect(calls[0].headers.get('idempotency-key')).toBe('connect-org');
  await gateway.createAccountLink({
    accountId: 'acct_v2',
    returnUrl: 'https://app.test/connect/return?org=org',
    refreshUrl: 'https://app.test/connect/refresh?org=org'
  });
  expect(JSON.parse(calls[1].body)).toMatchObject({
    use_case: {
      type: 'account_onboarding',
      account_onboarding: { refresh_url: 'https://app.test/connect/refresh?org=org' }
    }
  });
  expect(calls[1].body).not.toContain('configurations');
  expect(await gateway.getAccount('acct_v2')).toMatchObject({
    chargesEnabled: true,
    dashboardType: 'none'
  });
});
it('enables all embedded components, including mandatory notifications and account management', async () => {
  const { gateway, calls } = createHarness();
  await gateway.createAccountSession('acct_v2');
  const params = new URLSearchParams(calls[0].body);
  for (const name of [
    'notification_banner',
    'account_management',
    'account_onboarding',
    'payments',
    'payouts',
    'balances'
  ])
    expect(params.get(`components[${name}][enabled]`)).toBe('true');
  expect(params.get('components[payments][features][refund_management]')).toBe('true');
});
it.each([0n, 123n])(
  'sends only the platform application fee %s on a direct charge',
  async (applicationFeeAmount) => {
    const { gateway, calls } = createHarness();
    const expiresAt = new Date('2026-10-21T01:00:00Z');
    await gateway.createCheckoutSession({
      readyAccount: requireReadyConnectedAccount({
        stripeAccountId: 'acct_v2',
        chargesEnabled: true,
        onboardingStatus: 'ready'
      }),
      stripeAccountId: 'acct_v2',
      amountMinor: 5000n,
      currency: 'JPY',
      quantity: 1,
      productName: 'Meetup',
      referenceId: 'request:1',
      idempotencyKey: 'checkout-request-1',
      successUrl: 'https://app.test/checkout/done',
      cancelUrl: 'https://app.test/checkout/cancelled',
      expiresAt,
      applicationFeeAmount
    });
    const params = new URLSearchParams(calls[0].body);
    expect(calls[0].headers.get('stripe-account')).toBe('acct_v2');
    expect(params.get('payment_intent_data[application_fee_amount]')).toBe(
      applicationFeeAmount === 0n ? null : '123'
    );
    expect(params.get('expires_at')).toBe(String(expiresAt.getTime() / 1000));
    expect(params.get('allowed_payment_method_types[0]')).toBe('card');
  }
);
