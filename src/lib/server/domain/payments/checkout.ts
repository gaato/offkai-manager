import { systemClock, type Clock } from '$lib/server/clock';
import { read, write, type DatabaseClient } from '$lib/server/db/client';
import { and, asc, eq } from 'drizzle-orm';
import {
  collectionPaymentMethods,
  collections,
  events,
  organizations,
  paymentRequests,
  paymentCheckoutSessions,
  registrations,
  stripeConnectAccounts
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { requireReadyConnectedAccount, type PaymentGateway } from './gateway';
import { PaymentError } from './errors';

export interface StartCheckoutInput {
  userId: string;
  registrationId: string;
  successUrl: string;
  cancelUrl: string;
}

/** Reserve intent synchronously; no transaction spans Stripe. Re-read before attaching. */
export async function startCheckout(
  client: DatabaseClient,
  gateway: PaymentGateway,
  input: StartCheckoutInput,
  clock: Clock = systemClock
): Promise<string> {
  if (!input.successUrl || !input.cancelUrl)
    throw new PaymentError('validation', 'checkout URLs required');
  const intent = write(client, (tx) => {
    const row = tx
      .select({
        request: paymentRequests,
        registration: registrations,
        collection: collections,
        event: events,
        suspendedAt: organizations.suspendedAt,
        account: stripeConnectAccounts
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
        and(eq(registrations.id, input.registrationId), eq(registrations.userId, input.userId))
      )
      .orderBy(asc(collections.createdAt), asc(collections.id))
      .get();
    if (!row) throw new PaymentError('not_found', 'owned payment request not found');
    const { request, registration, collection, event, account } = row;
    if (
      row.suspendedAt ||
      event.cancelledAt ||
      event.archivedAt ||
      !['confirmed', 'held'].includes(registration.status) ||
      (registration.status === 'held' &&
        (!registration.holdExpiresAt || registration.holdExpiresAt <= clock.now())) ||
      collection.status !== 'open' ||
      collection.amountMinor <= 0n ||
      !['pending', 'payment_pending'].includes(request.status)
    )
      throw new PaymentError('not_payable', 'payment unavailable');
    if (!account?.chargesEnabled || account.onboardingStatus !== 'ready')
      throw new PaymentError('not_ready', 'payout account not ready');
    const readyAccount = requireReadyConnectedAccount(account);
    if (request.checkoutUrl && request.checkoutExpiresAt && request.checkoutExpiresAt > clock.now())
      return { reuse: request.checkoutUrl } as const;
    const method = tx
      .select()
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, collection.id),
          eq(collectionPaymentMethods.enabled, true),
          eq(collectionPaymentMethods.confirmation, 'internal')
        )
      )
      .get();
    if (!method) throw new PaymentError('invalid_method', 'Stripe method unavailable');
    // A pending intent with no attached session reuses its generation after retries/crashes.
    const inFlight =
      request.status === 'payment_pending' &&
      !request.checkoutSessionId &&
      request.checkoutExpiresAt &&
      request.checkoutExpiresAt > clock.now();
    const attempt = inFlight ? request.checkoutAttempt : request.checkoutAttempt + 1;
    let expiresAt = inFlight
      ? request.checkoutExpiresAt!
      : registration.status === 'held'
        ? registration.holdExpiresAt!
        : new Date(Math.floor(clock.now().getTime() / 1000) * 1000 + 60 * 60000);
    // Checkout must still be 30 minutes out when Stripe receives it. Start its clock here,
    // keeping the already reserved seat; subsequent refreshes reuse the session and deadline.
    if (
      !inFlight &&
      registration.status === 'held' &&
      expiresAt.getTime() - clock.now().getTime() < 31 * 60000
    ) {
      expiresAt = new Date(Math.ceil(clock.now().getTime() / 1000) * 1000 + 31 * 60000);
      tx.update(registrations)
        .set({ holdExpiresAt: expiresAt, updatedAt: clock.now() })
        .where(eq(registrations.id, registration.id))
        .run();
    }
    if (!inFlight && registration.status === 'held') {
      expiresAt = new Date(Math.ceil(expiresAt.getTime() / 1000) * 1000);
      tx.update(registrations)
        .set({ holdExpiresAt: expiresAt, updatedAt: clock.now() })
        .where(eq(registrations.id, registration.id))
        .run();
    }
    tx.update(paymentRequests)
      .set({
        status: 'payment_pending',
        stripeAccountId: account.stripeAccountId,
        chargeType: 'direct',
        collectionPaymentMethodId: method.id,
        checkoutAttempt: attempt,
        checkoutSessionId: '',
        checkoutUrl: '',
        checkoutExpiresAt: expiresAt,
        updatedAt: clock.now()
      })
      .where(eq(paymentRequests.id, request.id))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.userId,
        eventId: event.id,
        action: 'payment.stripe_checkout_begin',
        targetType: 'payment_request',
        targetId: request.id,
        after: { attempt }
      },
      clock
    );
    return { request, event, collection, readyAccount, attempt, expiresAt } as const;
  });
  if (intent.reuse !== undefined) return intent.reuse;
  let session;
  try {
    session = await gateway.createCheckoutSession({
      readyAccount: intent.readyAccount,
      stripeAccountId: intent.readyAccount.stripeAccountId,
      referenceId: `${intent.request.id}:${intent.attempt}`,
      productName: `${intent.event.title} - ${intent.collection.title}`,
      amountMinor: intent.request.amountMinor,
      currency: intent.request.currency,
      quantity: 1,
      applicationFeeAmount: intent.request.applicationFeeAmount,
      expiresAt: intent.expiresAt,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      idempotencyKey: `checkout-${intent.request.id}-${intent.attempt}`
    });
    if (!session.sessionId || !session.url) throw new Error('incomplete checkout session');
  } catch (cause) {
    // Keep the intent and its key: a network timeout may have created a real session.
    // Reusing the same key prevents two collectible sessions after an ambiguous failure.
    throw new PaymentError('gateway', 'create checkout session failed', { cause });
  }
  const attached = write(client, (tx) => {
    tx.insert(paymentCheckoutSessions)
      .values({
        sessionId: session.sessionId,
        paymentRequestId: intent.request.id,
        attempt: intent.attempt,
        expiresAt: intent.expiresAt,
        url: session.url
      })
      .onConflictDoNothing()
      .run();
    const current = tx
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, intent.request.id))
      .get()!;
    const registration = tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, current.registrationId))
      .get()!;
    if (current.status === 'paid') {
      appendAudit(
        tx,
        {
          actorUserId: input.userId,
          eventId: current.eventId,
          action: 'payment.checkout_already_settled',
          targetType: 'payment_request',
          targetId: current.id
        },
        clock
      );
      return 'paid';
    }
    const liveEvent = tx.select().from(events).where(eq(events.id, current.eventId)).get()!;
    const organization = tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, liveEvent.organizationId))
      .get()!;
    const valid =
      !liveEvent.cancelledAt &&
      !liveEvent.archivedAt &&
      !organization.suspendedAt &&
      current.status === 'payment_pending' &&
      current.checkoutAttempt === intent.attempt &&
      ['confirmed', 'held'].includes(registration.status) &&
      intent.expiresAt > clock.now() &&
      (registration.status !== 'held' ||
        (registration.holdExpiresAt && registration.holdExpiresAt > clock.now()));
    if (valid)
      tx.update(paymentRequests)
        .set({
          checkoutSessionId: session.sessionId,
          checkoutUrl: session.url,
          paymentIntentId: session.paymentIntentId ?? '',
          updatedAt: clock.now()
        })
        .where(eq(paymentRequests.id, current.id))
        .run();
    appendAudit(
      tx,
      {
        actorUserId: input.userId,
        eventId: current.eventId,
        action: valid ? 'payment.stripe_checkout_attach' : 'payment.stripe_checkout_stale',
        targetType: 'payment_request',
        targetId: current.id,
        after: { attempt: intent.attempt }
      },
      clock
    );
    return valid ? 'attached' : 'stale';
  });
  if (attached === 'paid') return input.successUrl;
  if (attached !== 'attached')
    throw new PaymentError('not_payable', 'checkout intent is no longer payable');
  return session.url;
}

export function ownedPaymentSnapshot(
  client: DatabaseClient,
  registrationId: string,
  userId: string
) {
  return read(
    client,
    (tx) =>
      tx
        .select({ request: paymentRequests })
        .from(paymentRequests)
        .innerJoin(registrations, eq(registrations.id, paymentRequests.registrationId))
        .where(and(eq(registrations.id, registrationId), eq(registrations.userId, userId)))
        .get()?.request ?? null
  );
}
