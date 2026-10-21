import Stripe from 'stripe';
import type {
  ConnectAccount,
  ConnectGateway,
  CreateCheckoutSessionInput,
  PaymentGateway
} from '$lib/server/domain/payments/gateway';
import { STRIPE_API_VERSION } from './api-version';

export class RealConnectGateway implements ConnectGateway, PaymentGateway {
  private readonly stripe: Stripe;

  constructor(secretKey: string, client?: Stripe) {
    this.stripe =
      client ??
      new Stripe(secretKey, {
        apiVersion: STRIPE_API_VERSION,
        typescript: true
      });
  }

  async createAccount(input: { organizationId: string }): Promise<{ accountId: string }> {
    const account = await this.stripe.v2.core.accounts.create(
      {
        identity: { country: 'jp', entity_type: 'individual' },
        dashboard: 'none',
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        metadata: { offkai_organization_id: input.organizationId }
      },
      { idempotencyKey: `connect-${input.organizationId}` }
    );
    return { accountId: account.id };
  }

  async createAccountLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }> {
    const link = await this.stripe.v2.core.accountLinks.create({
      account: input.accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { return_url: input.returnUrl, refresh_url: input.refreshUrl }
      }
    });
    return { url: link.url };
  }

  async getAccount(accountId: string): Promise<ConnectAccount> {
    const account = await this.stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.merchant', 'identity', 'requirements', 'defaults']
    });
    const active =
      account.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
    return {
      chargesEnabled: active,
      payoutsEnabled:
        account.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status === 'active',
      detailsSubmitted: active,
      country: account.identity?.country ?? '',
      defaultCurrency: account.defaults?.currency ?? 'jpy',
      dashboardType: 'none'
    };
  }

  async createAccountSession(accountId: string) {
    const session = await this.stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
        notification_banner: { enabled: true },
        account_management: { enabled: true },
        balances: { enabled: true },
        payouts: { enabled: true },
        payments: { enabled: true, features: { refund_management: true } }
      }
    });
    return { clientSecret: session.client_secret };
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
        allowed_payment_method_types: ['card'],
        ...(input.expiresAt ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
        ...(input.applicationFeeAmount && input.applicationFeeAmount > 0n
          ? { payment_intent_data: { application_fee_amount: Number(input.applicationFeeAmount) } }
          : {}),
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
        ]
      },
      { stripeAccount: input.readyAccount.stripeAccountId, idempotencyKey: input.idempotencyKey }
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
