import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { expireCheckout, settleCheckout } from '$lib/server/domain/payments';
import { formatMoney } from '$lib/shared/money';

function devSession(sessionId: string) {
  const config = getConfig();
  if (!config.auth.devBypass) throw error(404);
  const stripe = getApp(config).stripe;
  if (stripe.mode !== 'dev') throw error(404);
  const session = stripe.connect.checkoutSession(sessionId);
  if (!session) throw error(404);
  return session;
}

export const load: PageServerLoad = (event) => {
  const session = devSession(event.params.sessionId);
  return {
    productName: session.productName,
    amount: formatMoney(
      session.amountMinor * BigInt(session.quantity),
      session.currency,
      event.locals.locale
    )
  };
};

export const actions: Actions = {
  pay: async (event) => {
    const session = devSession(event.params.sessionId);
    try {
      await settleCheckout(getDatabaseClient(getConfig()), {
        stripeEventId: `evt_dev_${session.sessionId}`,
        eventType: 'checkout.session.completed',
        sessionId: session.sessionId,
        paymentIntentId: session.paymentIntentId,
        paymentStatus: 'paid',
        amountTotal: session.amountMinor * BigInt(session.quantity),
        currency: session.currency,
        stripeAccountId: session.stripeAccountId,
        raw: { dev: true, checkout_session_id: session.sessionId }
      });
    } catch (cause) {
      event.locals.logger.error({ err: cause }, 'development Stripe checkout settlement failed');
      throw error(400, event.locals.t('dev_stripe.checkout_error'));
    }
    throw redirect(303, session.successUrl);
  },
  cancel: async (event) => {
    const session = devSession(event.params.sessionId);
    try {
      await expireCheckout(getDatabaseClient(getConfig()), {
        stripeEventId: `evt_dev_expired_${session.sessionId}`,
        eventType: 'checkout.session.expired',
        sessionId: session.sessionId,
        stripeAccountId: session.stripeAccountId,
        raw: { dev: true, checkout_session_id: session.sessionId }
      });
    } catch (cause) {
      event.locals.logger.error({ err: cause }, 'development Stripe checkout expiration failed');
      throw error(400, event.locals.t('dev_stripe.checkout_error'));
    }
    throw redirect(303, session.cancelUrl);
  }
};
