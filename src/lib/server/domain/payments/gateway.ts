export type StripeDashboardType = 'express' | 'full' | 'none';

export interface ConnectAccount {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string;
  defaultCurrency: string;
  dashboardType: StripeDashboardType;
}

/** Stripe Connect account management without coupling the domain to Stripe's SDK. */
export interface ConnectGateway {
  createExpressAccount(input: { organizationId: string }): Promise<{
    accountId: string;
  }>;
  createAccountLink(input: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{
    url: string;
  }>;
  getAccount(accountId: string): Promise<ConnectAccount>;
}

export interface CreateCheckoutSessionInput {
  referenceId: string;
  productName: string;
  amountMinor: bigint;
  currency: string;
  quantity: number;
  stripeAccountId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

/** Hosted payment-session creation for participant obligations. */
export interface PaymentGateway {
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{
    sessionId: string;
    url: string;
    paymentIntentId?: string;
  }>;
}

interface VerifiedCheckoutEventBase {
  kind: 'settlement';
  stripeEventId: string;
  eventType: string;
  stripeAccountId: string;
  sessionId: string;
  raw: unknown;
}

export interface VerifiedCheckoutSettlementEvent extends VerifiedCheckoutEventBase {
  kind: 'settlement';
  paymentIntentId?: string;
  paymentStatus: string;
  amountTotal: bigint;
  currency: string;
}

export type VerifiedCheckoutEvent = VerifiedCheckoutSettlementEvent;

/** Signature verification and stable-field extraction for Stripe webhook envelopes. */
export interface StripeWebhookGateway {
  parseCheckoutEvent(payload: Uint8Array, signature: string): VerifiedCheckoutEvent | null;
}
