import { readLimitedBody, BodyTooLargeError, textResponse } from '$lib/server/gateways/stripe/body';
import type { RequestHandler } from './$types';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { settleCheckout } from '$lib/server/domain/payments';

export const POST: RequestHandler = async (event) => {
  const config = getConfig();
  const verifier = getApp(config).stripe.webhook;
  if (!verifier) return textResponse('webhook not configured', 503);

  let payload: Uint8Array;
  try {
    payload = await readLimitedBody(event.request, config.tuning.OFFKAI_WEBHOOK_MAX_BODY_BYTES);
  } catch (cause) {
    event.locals.logger.warn({ err: cause }, 'Stripe webhook body rejected');
    return textResponse(
      cause instanceof BodyTooLargeError ? 'payload too large' : 'invalid body',
      cause instanceof BodyTooLargeError ? 413 : 400
    );
  }

  let checkoutEvent;
  try {
    checkoutEvent = verifier.parseCheckoutEvent(
      payload,
      event.request.headers.get('stripe-signature') ?? ''
    );
  } catch (cause) {
    event.locals.logger.warn({ err: cause }, 'Stripe webhook rejected');
    return textResponse('invalid webhook', 400);
  }
  if (!checkoutEvent) return textResponse('ok', 200);

  try {
    const settlement = await settleCheckout(getDatabaseClient(config), checkoutEvent);
    if (settlement.alreadyProcessed) {
      event.locals.logger.info(
        { stripe_event_id: checkoutEvent.stripeEventId },
        'Stripe webhook already processed'
      );
    } else if (settlement.ignoredUnpaid) {
      event.locals.logger.info(
        {
          stripe_event_id: checkoutEvent.stripeEventId,
          checkout_session_id: checkoutEvent.sessionId
        },
        'Stripe checkout is not paid yet'
      );
    } else {
      event.locals.logger.info(
        {
          stripe_event_id: checkoutEvent.stripeEventId,
          payment_record_id: settlement.record?.id,
          kind: settlement.kind,
          conflict: settlement.conflict
        },
        'Stripe checkout settled'
      );
    }
    return textResponse('ok', 200);
  } catch (cause) {
    event.locals.logger.error(
      { err: cause, stripe_event_id: checkoutEvent.stripeEventId },
      'Stripe webhook settlement failed'
    );
    return textResponse('settlement failed', 500);
  }
};
