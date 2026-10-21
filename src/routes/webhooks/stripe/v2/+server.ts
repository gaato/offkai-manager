import { InvalidV2Notification } from '$lib/server/gateways/stripe/v2-webhook';
import type { RequestHandler } from './$types';
import { getConfig } from '$lib/server/config';
import { getApp } from '$lib/server/app';
import { getDatabaseClient } from '$lib/server/db/client';
import { applyAccountNotification } from '$lib/server/domain/payments/connect';
import { readLimitedBody, BodyTooLargeError, textResponse } from '$lib/server/gateways/stripe/body';
export const POST: RequestHandler = async ({ request, locals }) => {
  const config = getConfig();
  const stripe = getApp(config).stripe;
  const gateway = stripe.mode === 'real' ? stripe.v2Webhook : null;
  if (!gateway) return textResponse('webhook not configured', 503);
  try {
    const payload = await readLimitedBody(request, config.tuning.OFFKAI_WEBHOOK_MAX_BODY_BYTES);
    const input = await gateway.parseAndFetch(
      payload,
      request.headers.get('stripe-signature') ?? ''
    );
    if (input) applyAccountNotification(getDatabaseClient(config), input);
    return textResponse('ok', 200);
  } catch (cause) {
    locals.logger.warn({ err: cause }, 'Stripe v2 notification failed');
    return textResponse(
      'notification failed',
      cause instanceof BodyTooLargeError ? 413 : cause instanceof InvalidV2Notification ? 400 : 500
    );
  }
};
