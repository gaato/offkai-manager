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
