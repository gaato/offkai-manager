import Stripe from 'stripe';
import { z } from 'zod';
import { STRIPE_API_VERSION } from './api-version';
import type { ConnectAccount, ConnectGateway } from '$lib/server/domain/payments/gateway';
export class InvalidV2Notification extends Error {}
export interface AccountNotificationGateway {
  parseAndFetch(
    payload: Uint8Array,
    signature: string
  ): Promise<{ id: string; type: string; accountId: string; account: ConnectAccount } | null>;
}
export class StripeV2WebhookVerifier implements AccountNotificationGateway {
  private readonly stripe: Stripe;
  constructor(
    secretKey: string,
    private readonly secret: string,
    private readonly connect: ConnectGateway,
    client?: Stripe
  ) {
    this.stripe = client ?? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  }
  async parseAndFetch(payload: Uint8Array, signature: string) {
    let notification;
    try {
      notification = this.stripe.parseEventNotification(
        Buffer.from(payload),
        signature,
        this.secret
      );
    } catch (cause) {
      throw new InvalidV2Notification('invalid Stripe notification', { cause });
    }
    switch (notification.type) {
      case 'v2.core.account.created':
      case 'v2.core.account.updated':
      case 'v2.core.account.closed':
      case 'v2.core.account[configuration.merchant].capability_status_updated':
      case 'v2.core.account[configuration.merchant].updated':
      case 'v2.core.account[requirements].updated':
      case 'v2.core.account[future_requirements].updated':
      case 'v2.core.account[identity].updated':
      case 'v2.core.account[defaults].updated':
        break;
      default:
        return null;
    }
    const related = z
      .object({ id: z.string().min(1) })
      .parse(await notification.fetchRelatedObject());
    const account = await this.connect.getAccount(related.id);
    return { id: notification.id, type: notification.type, accountId: related.id, account };
  }
}
