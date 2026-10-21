import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { StripeWebhookVerifier } from '$lib/server/gateways/stripe/webhook';

const secret = 'whsec_unit_test';

describe('Stripe webhook stable-field parser', () => {
  it('accepts a signed checkout event from a different API version', () => {
    const payload = JSON.stringify({
      id: 'evt_version_drift',
      object: 'event',
      api_version: '2099-12-31.future',
      type: 'checkout.session.completed',
      account: 'acct_connected',
      data: {
        object: {
          id: 'cs_checkout',
          payment_status: 'paid',
          amount_total: 3000,
          currency: 'jpy',
          payment_intent: 'pi_checkout',
          future_field: { ignored: true }
        }
      }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const parsed = new StripeWebhookVerifier(secret).parseCheckoutEvent(
      new TextEncoder().encode(payload),
      signature
    );
    expect(parsed).toMatchObject({
      kind: 'settlement',
      stripeEventId: 'evt_version_drift',
      stripeAccountId: 'acct_connected',
      sessionId: 'cs_checkout',
      paymentIntentId: 'pi_checkout',
      paymentStatus: 'paid',
      amountTotal: 3000n,
      currency: 'JPY'
    });
  });
  it('rejects a valid signature outside Stripe default timestamp tolerance', () => {
    const payload = JSON.stringify({
      id: 'evt_expired',
      type: 'account.updated',
      data: { object: {} }
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
      timestamp: Math.floor(Date.now() / 1_000) - 600
    });
    expect(() =>
      new StripeWebhookVerifier(secret).parseCheckoutEvent(
        new TextEncoder().encode(payload),
        signature
      )
    ).toThrow(/Timestamp outside the tolerance zone/);
  });
  it('rejects a bad signature and ignores unrelated signed events', () => {
    const payload = JSON.stringify({
      id: 'evt_other',
      object: 'event',
      type: 'account.updated',
      data: { object: {} }
    });
    const verifier = new StripeWebhookVerifier(secret);
    expect(() => verifier.parseCheckoutEvent(new TextEncoder().encode(payload), 'bad')).toThrow();
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(verifier.parseCheckoutEvent(new TextEncoder().encode(payload), signature)).toBeNull();
  });
});

it.each([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired'
])('recognizes signed %s with its phase-1 request reference', (type) => {
  const payload = JSON.stringify({
    id: `evt_${type}`,
    type,
    account: 'acct_connected',
    data: {
      object: {
        id: 'cs',
        client_reference_id: 'request:1',
        payment_status: type.endsWith('expired') ? 'unpaid' : 'paid',
        amount_total: 1000,
        currency: 'jpy'
      }
    }
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  expect(
    new StripeWebhookVerifier(secret).parseCheckoutEvent(
      new TextEncoder().encode(payload),
      signature
    )
  ).toMatchObject({ eventType: type, referenceId: 'request:1' });
});
