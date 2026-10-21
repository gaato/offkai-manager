import Stripe from 'stripe';
import { z } from 'zod';
import type {
  StripeWebhookGateway,
  VerifiedCheckoutEvent
} from '$lib/server/domain/payments/gateway';
import { STRIPE_API_VERSION } from './api-version';

const envelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  account: z.string().optional().nullable(),
  data: z.object({ object: z.unknown() })
});

const checkoutSessionSchema = z.object({
  id: z.string().min(1),
  client_reference_id: z.string().optional().nullable(),
  application_fee_amount: z.number().int().nonnegative().optional().nullable(),
  payment_status: z.string().min(1),
  amount_total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().length(3),
  payment_intent: z
    .union([z.string(), z.object({ id: z.string() })])
    .optional()
    .nullable()
});

const checkoutEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired'
]);

export class StripeWebhookVerifier implements StripeWebhookGateway {
  private readonly stripe: Stripe;

  constructor(private readonly secret: string) {
    this.stripe = new Stripe('sk_webhook_verification_only', {
      apiVersion: STRIPE_API_VERSION,
      typescript: true
    });
  }

  parseCheckoutEvent(payload: Uint8Array, signature: string): VerifiedCheckoutEvent | null {
    const rawText = new TextDecoder().decode(payload);
    this.stripe.webhooks.constructEvent(Buffer.from(payload), signature, this.secret);

    // stripe-node does not reject endpoint API-version drift. Parse the raw
    // envelope again so settlement depends only on long-stable fields rather
    // than the SDK's pinned Checkout Session shape.
    const raw = JSON.parse(rawText) as unknown;
    const envelope = envelopeSchema.parse(raw);
    if (!checkoutEvents.has(envelope.type)) return null;
    const session = checkoutSessionSchema.parse(envelope.data.object);
    const paymentIntent = session.payment_intent;
    return {
      kind: 'settlement',
      stripeEventId: envelope.id,
      eventType: envelope.type,
      stripeAccountId: envelope.account ?? '',
      sessionId: session.id,
      ...(session.client_reference_id ? { referenceId: session.client_reference_id } : {}),
      ...(session.application_fee_amount !== undefined && session.application_fee_amount !== null
        ? { applicationFeeAmount: BigInt(session.application_fee_amount) }
        : {}),
      ...(paymentIntent
        ? { paymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id }
        : {}),
      paymentStatus: session.payment_status,
      amountTotal: BigInt(session.amount_total),
      currency: session.currency.toUpperCase(),
      raw
    };
  }
}
