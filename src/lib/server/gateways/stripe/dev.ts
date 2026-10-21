import { randomBytes } from 'node:crypto';
import type {
  ConnectAccount,
  ConnectGateway,
  CreateCheckoutSessionInput,
  PaymentGateway
} from '$lib/server/domain/payments/gateway';

interface DevAccount {
  ready: boolean;
  returnUrl: string;
  refreshUrl: string;
}

export interface DevCheckoutSession {
  sessionId: string;
  paymentIntentId: string;
  referenceId: string;
  productName: string;
  amountMinor: bigint;
  quantity: number;
  currency: string;
  stripeAccountId: string;
  successUrl: string;
  cancelUrl: string;
}

export class DevConnectGateway implements ConnectGateway, PaymentGateway {
  private sequence = 0;
  private readonly accounts = new Map<string, DevAccount>();
  private readonly sessions = new Map<string, DevCheckoutSession>();
  private readonly checkoutIdempotency = new Map<string, string>();

  async createAccount(): Promise<{ accountId: string }> {
    this.sequence += 1;
    const accountId = `acct_dev_${this.sequence}`;
    this.accounts.set(accountId, { ready: false, returnUrl: '', refreshUrl: '' });
    return { accountId };
  }

  async createAccountLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }> {
    const account = this.requireAccount(input.accountId);
    account.returnUrl = input.returnUrl;
    account.refreshUrl = input.refreshUrl;
    return { url: `/dev/stripe/onboarding/${encodeURIComponent(input.accountId)}` };
  }

  async createAccountSession() {
    return { clientSecret: 'e2e_account_session' };
  }

  async getAccount(accountId: string): Promise<ConnectAccount> {
    const account = this.requireAccount(accountId);
    return {
      chargesEnabled: account.ready,
      payoutsEnabled: account.ready,
      detailsSubmitted: account.ready,
      country: 'JP',
      defaultCurrency: 'jpy',
      dashboardType: 'none'
    };
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{
    sessionId: string;
    url: string;
    paymentIntentId: string;
  }> {
    // The database is authoritative for readiness. Accepting a seeded account ID keeps
    // development Checkout usable across process restarts and disposable E2E databases.
    const quantity = checkoutQuantity(input.quantity);
    const existingId = this.checkoutIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.sessions.get(existingId)!;
      if (
        existing.referenceId !== input.referenceId ||
        existing.stripeAccountId !== input.stripeAccountId ||
        existing.amountMinor !== input.amountMinor ||
        existing.quantity !== quantity ||
        existing.currency.toUpperCase() !== input.currency.toUpperCase()
      ) {
        throw new Error('development Stripe idempotency key was reused with different input');
      }
      return checkoutResult(existing);
    }

    const token = randomBytes(16).toString('hex');
    const session: DevCheckoutSession = {
      sessionId: `cs_dev_${token}`,
      paymentIntentId: `pi_dev_${token}`,
      referenceId: input.referenceId,
      productName: input.productName,
      amountMinor: input.amountMinor,
      quantity,
      currency: input.currency.toUpperCase(),
      stripeAccountId: input.stripeAccountId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl
    };
    this.sessions.set(session.sessionId, session);
    this.checkoutIdempotency.set(input.idempotencyKey, session.sessionId);
    return checkoutResult(session);
  }

  checkoutSession(sessionId: string): DevCheckoutSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  onboardingReturn(accountId: string, complete: boolean): string {
    const account = this.requireAccount(accountId);
    account.ready = complete;
    return account.returnUrl || '/app';
  }

  private requireAccount(accountId: string): DevAccount {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('development Stripe account not found');
    return account;
  }
}

function checkoutQuantity(value: number): number {
  const quantity = value <= 0 ? 1 : value;
  if (!Number.isSafeInteger(quantity)) throw new Error('checkout quantity must be an integer');
  return quantity;
}

function checkoutResult(session: DevCheckoutSession) {
  return {
    sessionId: session.sessionId,
    paymentIntentId: session.paymentIntentId,
    url: `/dev/stripe/checkout/${encodeURIComponent(session.sessionId)}`
  };
}
