import { systemClock, type Clock } from '$lib/server/clock';
import { write } from '$lib/server/db/client';
import { and, asc, eq, or } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  collectionPaymentMethods,
  collections,
  events,
  organizations,
  paymentRequests,
  registrations,
  stripeConnectAccounts
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import type { PaymentGateway } from './gateway';
import { PaymentError } from './errors';

export interface StartCheckoutInput {
  userId: string;
  registrationId: string;
  successUrl: string;
  cancelUrl: string;
}

interface CheckoutIntent {
  actorUserId: string;
  requestId: string;
  eventId: string;
  stripeAccountId: string;
  amountMinor: bigint;
  currency: string;
  eventTitle: string;
  collectionTitle: string;
  previousStatus: 'pending' | 'payment_pending';
}

/** Starts one direct-charge Checkout Session for an owned participant obligation. */
export async function startCheckout(
  client: DatabaseClient,
  gateway: PaymentGateway,
  input: StartCheckoutInput,
  clock: Clock = systemClock
): Promise<string> {
  if (!input.successUrl || !input.cancelUrl) {
    throw new PaymentError('validation', 'checkout return URLs are required');
  }
  const intent = write(client, (tx) => beginCheckout(tx, input, clock));
  let session;
  try {
    session = await gateway.createCheckoutSession({
      referenceId: intent.requestId,
      productName: intent.collectionTitle
        ? `${intent.eventTitle} - ${intent.collectionTitle}`
        : intent.eventTitle,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      quantity: 1,
      stripeAccountId: intent.stripeAccountId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      idempotencyKey: `checkout-${intent.requestId}`
    });
  } catch (cause) {
    await restoreFailedStart(client, intent, clock);
    throw new PaymentError('gateway', 'create checkout session failed', { cause });
  }
  if (!session.sessionId || !session.url) {
    await restoreFailedStart(client, intent, clock);
    throw new PaymentError('gateway', 'checkout gateway returned an incomplete session');
  }
  await attachCheckout(client, intent, session, clock);
  return session.url;
}

function beginCheckout(
  tx: DatabaseTransaction,
  input: Pick<StartCheckoutInput, 'userId' | 'registrationId'>,
  clock: Clock = systemClock
): CheckoutIntent {
  const rows = tx
    .select({
      request: paymentRequests,
      collection: collections,
      registrationStatus: registrations.status,
      eventTitle: events.title,
      eventCancelledAt: events.cancelledAt,
      eventArchivedAt: events.archivedAt,
      organizationSuspendedAt: organizations.suspendedAt,
      connectAccountId: stripeConnectAccounts.stripeAccountId,
      connectStatus: stripeConnectAccounts.onboardingStatus,
      chargesEnabled: stripeConnectAccounts.chargesEnabled
    })
    .from(paymentRequests)
    .innerJoin(registrations, eq(registrations.id, paymentRequests.registrationId))
    .innerJoin(collections, eq(collections.id, paymentRequests.collectionId))
    .innerJoin(events, eq(events.id, paymentRequests.eventId))
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.organizationId, events.organizationId)
    )
    .where(
      and(
        eq(paymentRequests.registrationId, input.registrationId),
        eq(registrations.userId, input.userId)
      )
    )
    .orderBy(asc(collections.createdAt), asc(collections.id))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) throw new PaymentError('not_found', 'owned payment request not found');
  if (row.organizationSuspendedAt || row.eventCancelledAt || row.eventArchivedAt) {
    throw new PaymentError('not_payable', 'event is not accepting payments');
  }
  if (row.registrationStatus !== 'confirmed') {
    throw new PaymentError('not_payable', 'registration is not confirmed');
  }
  if (row.collection.status !== 'open' || row.collection.amountMinor <= 0n) {
    throw new PaymentError('not_payable', 'collection is not accepting payments');
  }
  if (!['pending', 'payment_pending'].includes(row.request.status)) {
    throw new PaymentError('not_payable', 'payment request is already terminal');
  }
  if (!row.connectAccountId || row.connectStatus !== 'ready' || row.chargesEnabled !== true) {
    throw new PaymentError('not_ready', 'organization has no ready Stripe account');
  }
  const methodRows = tx
    .select({ id: collectionPaymentMethods.id })
    .from(collectionPaymentMethods)
    .where(
      and(
        eq(collectionPaymentMethods.collectionId, row.collection.id),
        eq(collectionPaymentMethods.enabled, true),
        eq(collectionPaymentMethods.confirmation, 'internal')
      )
    )
    .orderBy(asc(collectionPaymentMethods.sortOrder), asc(collectionPaymentMethods.id))
    .limit(1)
    .all();
  if (!methodRows[0]) {
    throw new PaymentError('invalid_method', 'collection does not accept Stripe payments');
  }
  const previousStatus = row.request.status as CheckoutIntent['previousStatus'];
  tx.update(paymentRequests)
    .set({
      collectionPaymentMethodId: methodRows[0].id,
      stripeAccountId: row.connectAccountId,
      status: 'payment_pending',
      updatedAt: clock.now()
    })
    .where(eq(paymentRequests.id, row.request.id))
    .run();
  appendAudit(
    tx,
    {
      actorUserId: input.userId,
      eventId: row.request.eventId,
      action: 'payment.stripe_checkout_begin',
      targetType: 'payment_request',
      targetId: row.request.id,
      before: { status: row.request.status },
      after: { status: 'payment_pending', stripeAccountSnapshotted: true }
    },
    clock
  );
  return {
    actorUserId: input.userId,
    requestId: row.request.id,
    eventId: row.request.eventId,
    stripeAccountId: row.connectAccountId,
    amountMinor: row.request.amountMinor,
    currency: row.request.currency,
    eventTitle: row.eventTitle,
    collectionTitle: row.collection.title,
    previousStatus
  };
}

async function restoreFailedStart(
  client: DatabaseClient,
  intent: CheckoutIntent,
  clock: Clock = systemClock
): Promise<void> {
  if (intent.previousStatus === 'payment_pending') return;
  write(client, (tx) => {
    const restored = tx
      .update(paymentRequests)
      .set({
        status: intent.previousStatus,
        stripeAccountId: '',
        chargeType: '',
        updatedAt: clock.now()
      })
      .where(
        and(
          eq(paymentRequests.id, intent.requestId),
          eq(paymentRequests.status, 'payment_pending'),
          eq(paymentRequests.checkoutSessionId, '')
        )
      )
      .returning({ id: paymentRequests.id })
      .all();
    if (!restored[0]) return;
    appendAudit(
      tx,
      {
        actorUserId: intent.actorUserId,
        eventId: intent.eventId,
        action: 'payment.stripe_checkout_failed',
        targetType: 'payment_request',
        targetId: intent.requestId,
        before: { status: 'payment_pending' },
        after: { status: intent.previousStatus }
      },
      clock
    );
  });
}

async function attachCheckout(
  client: DatabaseClient,
  intent: CheckoutIntent,
  session: {
    sessionId: string;
    paymentIntentId?: string;
  },
  clock: Clock = systemClock
): Promise<void> {
  write(client, (tx) => {
    const rows = tx
      .select({ request: paymentRequests })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, intent.requestId))
      .limit(1)
      .all();
    const request = rows[0]?.request;
    if (!request || !['pending', 'payment_pending'].includes(request.status)) {
      throw new PaymentError('not_payable', 'payment request is no longer payable');
    }
    if (request.stripeAccountId && request.stripeAccountId !== intent.stripeAccountId) {
      throw new PaymentError('conflict', 'connected account snapshot changed');
    }
    if (request.checkoutSessionId && request.checkoutSessionId !== session.sessionId) {
      throw new PaymentError('conflict', 'another checkout session is already attached');
    }
    const updated = tx
      .update(paymentRequests)
      .set({
        stripeAccountId: intent.stripeAccountId,
        checkoutSessionId: session.sessionId,
        paymentIntentId: session.paymentIntentId ?? '',
        chargeType: 'direct',
        status: 'payment_pending',
        updatedAt: clock.now()
      })
      .where(
        and(
          eq(paymentRequests.id, intent.requestId),
          or(
            eq(paymentRequests.checkoutSessionId, ''),
            eq(paymentRequests.checkoutSessionId, session.sessionId)
          )
        )
      )
      .returning({ id: paymentRequests.id })
      .all();
    if (!updated[0]) {
      throw new PaymentError('conflict', 'checkout session attachment lost a race');
    }
    appendAudit(
      tx,
      {
        actorUserId: intent.actorUserId,
        eventId: intent.eventId,
        action: 'payment.stripe_checkout_attach',
        targetType: 'payment_request',
        targetId: intent.requestId,
        before: { status: request.status },
        after: {
          status: 'payment_pending',
          chargeType: 'direct',
          hasCheckoutSession: true,
          hasPaymentIntent: Boolean(session.paymentIntentId)
        }
      },
      clock
    );
  });
}
