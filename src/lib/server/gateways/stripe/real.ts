import Stripe from 'stripe';
import type {
  ConnectAccount,
  ConnectGateway,
  CreateCheckoutSessionInput,
  PaymentGateway,
  StripeDashboardType
} from '$lib/server/domain/payments/gateway';
import { STRIPE_API_VERSION } from './api-version';

export class RealConnectGateway implements ConnectGateway, PaymentGateway {
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true
    });
  }

  async createExpressAccount(input: { organizationId: string }): Promise<{ accountId: string }> {
    const account = await this.stripe.accounts.create({
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      metadata: { offkai_organization_id: input.organizationId }
    });
    return { accountId: account.id };
  }

  async createAccountLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }> {
    const link = await this.stripe.accountLinks.create({
      account: input.accountId,
      return_url: input.returnUrl,
      refresh_url: input.refreshUrl,
      type: 'account_onboarding'
    });
    return { url: link.url };
  }

  async getAccount(accountId: string): Promise<ConnectAccount> {
    const account = await this.stripe.accounts.retrieve(accountId);
    return {
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      country: account.country ?? '',
      defaultCurrency: account.default_currency ?? '',
      dashboardType: dashboardType(account)
    };
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{
    sessionId: string;
    url: string;
    paymentIntentId?: string;
  }> {
    const amountMinor = Number(input.amountMinor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new Error('checkout amount is outside the Stripe integer range');
    }
    const quantity = checkoutQuantity(input.quantity);
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: input.referenceId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        line_items: [
          {
            quantity,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: amountMinor,
              product_data: { name: input.productName }
            }
          }
        ],
        ...(input.expireAfter
          ? { expires_at: Math.floor((Date.now() + input.expireAfter) / 1_000) }
          : {})
      },
      { stripeAccount: input.stripeAccountId, idempotencyKey: input.idempotencyKey }
    );
    const paymentIntent = session.payment_intent;
    return {
      sessionId: session.id,
      url: session.url ?? '',
      ...(paymentIntent
        ? { paymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id }
        : {})
    };
  }
}

function checkoutQuantity(value: number): number {
  const quantity = value <= 0 ? 1 : value;
  if (!Number.isSafeInteger(quantity)) throw new Error('checkout quantity must be an integer');
  return quantity;
}

function dashboardType(account: Stripe.Account): StripeDashboardType {
  const dashboard = account.controller?.stripe_dashboard?.type;
  if (dashboard === 'express' || dashboard === 'full' || dashboard === 'none') return dashboard;
  if (account.type === 'express') return 'express';
  if (account.type === 'standard' || account.type === 'custom') return 'full';
  return 'none';
}
