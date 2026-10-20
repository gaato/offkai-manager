import { describe, expect, it } from 'vitest';
import { DevConnectGateway } from '$lib/server/gateways/stripe/dev';

describe('development Stripe Checkout', () => {
  it('retains quantity and expiry on an idempotent session', async () => {
    const gateway = new DevConnectGateway();
    const { accountId } = await gateway.createExpressAccount();
    const input = {
      referenceId: 'order-reference',
      productName: 'Campaign pledge',
      amountMinor: 1_000n,
      currency: 'JPY',
      quantity: 3,
      stripeAccountId: accountId,
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
      idempotencyKey: 'pledge-order-reference',
      expireAfter: 3_600_000
    };

    const first = await gateway.createCheckoutSession(input);
    const duplicate = await gateway.createCheckoutSession(input);
    expect(duplicate).toEqual(first);
    expect(gateway.checkoutSession(first.sessionId)).toMatchObject({
      amountMinor: 1_000n,
      quantity: 3,
      expireAfter: 3_600_000
    });
  });

  it('accepts a database-seeded ready account identifier', async () => {
    const gateway = new DevConnectGateway();
    const result = await gateway.createCheckoutSession({
      referenceId: 'seeded-order',
      productName: 'Seeded campaign',
      amountMinor: 500n,
      currency: 'JPY',
      quantity: 2,
      stripeAccountId: 'acct_dev_seeded',
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
      idempotencyKey: 'pledge-seeded-order'
    });
    expect(gateway.checkoutSession(result.sessionId)).toMatchObject({
      stripeAccountId: 'acct_dev_seeded',
      quantity: 2
    });
  });
});
