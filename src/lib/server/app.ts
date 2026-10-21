import {
  StripeV2WebhookVerifier,
  type AccountNotificationGateway
} from '$lib/server/gateways/stripe/v2-webhook';
import type { Config } from '$lib/server/config';
import type {
  ConnectGateway,
  PaymentGateway,
  StripeWebhookGateway
} from '$lib/server/domain/payments/gateway';
import { DevConnectGateway } from '$lib/server/gateways/stripe/dev';
import { RealConnectGateway } from '$lib/server/gateways/stripe/real';
import { StripeWebhookVerifier } from '$lib/server/gateways/stripe/webhook';

export type StripeApp =
  | {
      mode: 'real';
      v2Webhook?: AccountNotificationGateway | null;
      connect: ConnectGateway;
      payment: PaymentGateway;
      webhook: StripeWebhookGateway | null;
    }
  | {
      mode: 'dev';
      connect: DevConnectGateway;
      payment: PaymentGateway | null;
      webhook: StripeWebhookGateway | null;
    }
  | { mode: 'disabled'; connect: null; payment: null; webhook: null };

export interface AppServices {
  stripe: StripeApp;
}

let singleton: AppServices | undefined;

export function createApp(config: Config): AppServices {
  if (config.stripe.secretKey) {
    const gateway = new RealConnectGateway(config.stripe.secretKey);
    return {
      stripe: {
        mode: 'real',
        v2Webhook: config.stripe.v2WebhookSecret
          ? new StripeV2WebhookVerifier(
              config.stripe.secretKey,
              config.stripe.v2WebhookSecret,
              gateway
            )
          : null,
        connect: gateway,
        payment: gateway,
        webhook: config.stripe.webhookSecret
          ? new StripeWebhookVerifier(config.stripe.webhookSecret)
          : null
      }
    };
  }
  if (config.auth.devBypass) {
    const gateway = new DevConnectGateway();
    return {
      stripe: {
        mode: 'dev',
        connect: gateway,
        payment: gateway,
        webhook: config.stripe.webhookSecret
          ? new StripeWebhookVerifier(config.stripe.webhookSecret)
          : null
      }
    };
  }
  return { stripe: { mode: 'disabled', connect: null, payment: null, webhook: null } };
}

export function getApp(config: Config): AppServices {
  singleton ??= createApp(config);
  return singleton;
}

export function resetAppForTests(): void {
  singleton = undefined;
}
