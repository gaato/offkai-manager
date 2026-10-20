import type { RequestHandler } from './$types';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { expireCheckout, settleCheckout } from '$lib/server/domain/payments';

const maxBodyBytes = 1 << 20;

export const POST: RequestHandler = async (event) => {
  const config = getConfig();
  const verifier = getApp(config).stripe.webhook;
  if (!verifier) return textResponse('webhook not configured', 503);

  let payload: Uint8Array;
  try {
    payload = await readLimitedBody(event.request, maxBodyBytes);
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
    if (checkoutEvent.kind === 'expiration') {
      const expiration = await expireCheckout(getDatabaseClient(config), checkoutEvent);
      event.locals.logger.info(
        {
          stripe_event_id: checkoutEvent.stripeEventId,
          checkout_session_id: checkoutEvent.sessionId,
          kind: expiration.kind,
          order_id: expiration.order?.id,
          expired: expiration.expired,
          already_processed: expiration.alreadyProcessed
        },
        'Stripe checkout expiration processed'
      );
      return textResponse('ok', 200);
    }
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
          order_id: settlement.order?.id,
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

class BodyTooLargeError extends Error {}

async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > limit) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function textResponse(body: string, status: number): Response {
  return new Response(`${body}\n`, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
