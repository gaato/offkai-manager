import { completeAttendancePayment } from './completion';
import { promoteOldestWaitlisted } from '../registrations/promotion';
import { enqueuePanelRefresh, enqueueRoleSync } from '../discord/outbox';
import { enqueueNotification } from '../notifications/outbox';
import { systemClock, type Clock } from '$lib/server/clock';
import { write } from '$lib/server/db/client';
import { and, eq } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  events,
  paymentRecords,
  paymentCheckoutSessions,
  paymentRequests,
  registrations,
  stripeWebhookEvents
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import type { PaymentRecord } from './requests';
import { PaymentError, SettlementError } from './errors';

export interface SettleCheckoutInput {
  stripeEventId?: string;
  eventType?: string;
  sessionId: string;
  referenceId?: string;
  applicationFeeAmount?: bigint;
  paymentIntentId?: string;
  paymentStatus: string;
  amountTotal: bigint;
  currency: string;
  stripeAccountId: string;
  raw: unknown;
}

export interface CheckoutSettlement {
  alreadyProcessed: boolean;
  ignoredUnpaid: boolean;
  conflict: boolean;
  kind: 'payment_request' | null;
  record: PaymentRecord | null;
}

export interface MarkRefundedInput {
  actorUserId: string;
  eventId: string;
  paymentRecordId: string;
  note: string;
}

/** Settles verified Checkout money once, preserving late-arrival conflicts as ledger facts. */
export async function settleCheckout(
  client: DatabaseClient,
  input: SettleCheckoutInput,
  clock: Clock = systemClock
): Promise<CheckoutSettlement> {
  if (!input.sessionId) throw new SettlementError('validation', 'checkout session id is required');
  if (input.amountTotal < 0n) {
    throw new SettlementError('validation', 'checkout amount cannot be negative');
  }
  const currency = input.currency.trim().toUpperCase();
  if (currency.length !== 3) {
    throw new SettlementError('validation', 'checkout currency must contain three letters');
  }
  const stripeEventId = input.stripeEventId?.trim() ?? '';
  if (input.stripeEventId !== undefined && !stripeEventId) {
    throw new SettlementError('validation', 'stripe event id cannot be blank');
  }
  return write(client, (tx) => {
    const webhookInserted = insertWebhookEvent(
      tx,
      {
        stripeEventId,
        stripeAccountId: input.stripeAccountId,
        eventType: input.eventType?.trim() || 'checkout.session.completed',
        raw: input.raw
      },
      clock
    );
    const history = tx
      .select()
      .from(paymentCheckoutSessions)
      .where(eq(paymentCheckoutSessions.sessionId, input.sessionId))
      .get();
    const reference = input.referenceId?.split(':');
    const request =
      tx
        .select()
        .from(paymentRequests)
        .where(
          history
            ? eq(paymentRequests.id, history.paymentRequestId)
            : eq(paymentRequests.checkoutSessionId, input.sessionId)
        )
        .get() ??
      (reference && reference.length === 2
        ? tx.select().from(paymentRequests).where(eq(paymentRequests.id, reference[0])).get()
        : undefined);
    if (request && !history && request.checkoutSessionId !== input.sessionId) {
      if (
        request.stripeAccountId !== input.stripeAccountId ||
        !reference ||
        Number(reference[1]) < 1 ||
        Number(reference[1]) > request.checkoutAttempt ||
        request.checkoutAttempt === 0
      )
        throw new SettlementError('resolution_miss', 'unrecognized checkout intent');
      tx.insert(paymentCheckoutSessions)
        .values({
          sessionId: input.sessionId,
          paymentRequestId: request.id,
          attempt: request.checkoutAttempt,
          expiresAt: request.checkoutExpiresAt!,
          url: ''
        })
        .onConflictDoNothing()
        .run();
    }
    if (request) {
      if (!webhookInserted) return alreadyProcessed('payment_request');
      return settlePaymentRequest(tx, request, input, currency, stripeEventId, clock);
    }
    if (!webhookInserted) return alreadyProcessed();
    throw new SettlementError(
      'resolution_miss',
      `no payment request for checkout session ${input.sessionId}`
    );
  });
}

function settlePaymentRequest(
  tx: DatabaseTransaction,
  request: typeof paymentRequests.$inferSelect,
  input: SettleCheckoutInput,
  currency: string,
  stripeEventId: string,
  clock: Clock = systemClock
): CheckoutSettlement {
  if (!request.stripeAccountId || request.stripeAccountId !== input.stripeAccountId) {
    throw new SettlementError('account_mismatch', 'webhook connected account does not match');
  }
  if (input.eventType === 'checkout.session.expired') {
    if (
      request.status === 'payment_pending' &&
      (request.checkoutSessionId === input.sessionId ||
        (!request.checkoutSessionId &&
          input.referenceId === `${request.id}:${request.checkoutAttempt}`))
    ) {
      tx.update(paymentRequests)
        .set({ status: 'pending', checkoutUrl: '', updatedAt: clock.now() })
        .where(eq(paymentRequests.id, request.id))
        .run();
      appendAudit(
        tx,
        {
          actorUserId: null,
          eventId: request.eventId,
          action: 'payment.checkout_expired',
          targetType: 'payment_request',
          targetId: request.id
        },
        clock
      );
    }
    markWebhookProcessed(tx, stripeEventId, clock);
    return {
      alreadyProcessed: false,
      ignoredUnpaid: true,
      conflict: false,
      kind: 'payment_request',
      record: null
    };
  }
  if (input.paymentStatus !== 'paid') {
    markWebhookProcessed(tx, stripeEventId, clock);
    return {
      alreadyProcessed: false,
      ignoredUnpaid: true,
      conflict: false,
      kind: 'payment_request',
      record: null
    };
  }
  if (
    tx
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.idempotencyKey, `stripe-session:${input.sessionId}`))
      .get()
  ) {
    markWebhookProcessed(tx, stripeEventId, clock);
    return alreadyProcessed('payment_request');
  }
  if (input.amountTotal !== request.amountMinor || currency !== request.currency.toUpperCase()) {
    throw new SettlementError('amount_mismatch', 'checkout amount or currency does not match');
  }
  const recordRows = tx
    .insert(paymentRecords)
    .values({
      createdAt: clock.now(),
      paymentRequestId: request.id,
      registrationId: request.registrationId,
      collectionId: request.collectionId,
      collectionPaymentMethodId: request.collectionPaymentMethodId,
      externalReference: input.paymentIntentId ?? '',
      note: '',
      applicationFeeAmount: request.applicationFeeAmount,
      amountMinor: request.amountMinor,
      currency: request.currency,
      status: 'settled',
      confirmedAt: clock.now(),
      rawPayloadJson: jsonPayload(input.raw),
      idempotencyKey: `stripe-session:${input.sessionId}`
    })
    .returning()
    .all();
  const record = recordRows[0];
  const registration = tx
    .select()
    .from(registrations)
    .where(eq(registrations.id, request.registrationId))
    .get()!;
  const event = tx.select().from(events).where(eq(events.id, request.eventId)).get()!;
  const conflict =
    ['cancelled', 'waived', 'paid', 'refund_due'].includes(request.status) ||
    registration.status === 'cancelled' ||
    Boolean(event.cancelledAt) ||
    (registration.status === 'held' &&
      (!registration.holdExpiresAt || registration.holdExpiresAt <= clock.now()));
  if (conflict) {
    tx.update(paymentRequests)
      .set({ status: 'refund_due', updatedAt: clock.now() })
      .where(eq(paymentRequests.id, request.id))
      .run();
    if (registration.status === 'held')
      tx.update(registrations)
        .set({ status: 'cancelled', holdReleased: true, updatedAt: clock.now() })
        .where(eq(registrations.id, registration.id))
        .run();
    enqueuePanelRefresh(tx, request.eventId, clock);
    if (registration.status === 'held') {
      enqueueRoleSync(tx, request.eventId, registration.id, clock);
      enqueueNotification(tx, registration.id, 'hold_expired', clock);
      if (
        event.registrationMode === 'auto_confirm' &&
        !event.cancelledAt &&
        !event.archivedAt &&
        clock.now() < event.startsAt
      )
        promoteOldestWaitlisted(
          tx,
          {
            eventId: event.id,
            capacity: event.capacity,
            actorUserId: registration.userId,
            reason: 'late payment after hold release'
          },
          clock
        );
    }
  }
  if (!conflict) {
    tx.update(paymentRequests)
      .set({
        status: 'paid',
        paymentIntentId: input.paymentIntentId ?? request.paymentIntentId,
        updatedAt: clock.now()
      })
      .where(eq(paymentRequests.id, request.id))
      .run();
  }
  if (!conflict) completeAttendancePayment(tx, request, clock, record.id, 'paid');
  markWebhookProcessed(tx, stripeEventId, clock);
  appendAudit(
    tx,
    {
      actorUserId: null,
      eventId: request.eventId,
      action: conflict ? 'payment.stripe_settle_conflict' : 'payment.stripe_settle',
      targetType: 'payment_request',
      targetId: request.id,
      before: { status: request.status },
      after: {
        status: conflict ? 'refund_due' : 'paid',
        paymentRecordId: record.id,
        amountMinor: record.amountMinor.toString(),
        currency: record.currency,
        conflict
      }
    },
    clock
  );
  return {
    alreadyProcessed: false,
    ignoredUnpaid: false,
    conflict,
    kind: 'payment_request',
    record
  };
}

function insertWebhookEvent(
  tx: DatabaseTransaction,
  input: {
    stripeEventId: string;
    stripeAccountId: string;
    eventType: string;
    raw: unknown;
  },
  clock: Clock = systemClock
): boolean {
  if (!input.stripeEventId) return true;
  const inserted = tx
    .insert(stripeWebhookEvents)
    .values({
      createdAt: clock.now(),
      stripeEventId: input.stripeEventId,
      stripeAccountId: input.stripeAccountId,
      eventType: input.eventType,
      payloadJson: jsonPayload(input.raw)
    })
    .onConflictDoNothing({ target: stripeWebhookEvents.stripeEventId })
    .returning({ id: stripeWebhookEvents.id })
    .all();
  return Boolean(inserted[0]);
}

/** Adds the manual refund fact for one unresolved late-settlement conflict. */
export async function markConflictRefunded(
  client: DatabaseClient,
  input: MarkRefundedInput,
  clock: Clock = systemClock
): Promise<PaymentRecord> {
  const note = input.note.trim();
  if (note.length > 2000) throw new PaymentError('validation', 'refund note is too long');
  return write(client, (tx) => {
    const rows = tx
      .select({
        record: paymentRecords,
        requestStatus: paymentRequests.status,
        requestEventId: paymentRequests.eventId,
        organizationId: events.organizationId,
        registrationStatus: registrations.status
      })
      .from(paymentRecords)
      .innerJoin(paymentRequests, eq(paymentRequests.id, paymentRecords.paymentRequestId))
      .innerJoin(events, eq(events.id, paymentRequests.eventId))
      .innerJoin(registrations, eq(registrations.id, paymentRecords.registrationId))
      .where(eq(paymentRecords.id, input.paymentRecordId))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row || row.requestEventId !== input.eventId) {
      throw new PaymentError('not_found', 'settlement conflict record not found');
    }
    authorizeOrganizationRole(tx, row.organizationId, input.actorUserId, 'organizer');
    const idempotencyKey = `manual_refund:${row.record.id}`;
    const existing = tx
      .select()
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.idempotencyKey, idempotencyKey),
          eq(paymentRecords.status, 'refunded')
        )
      )
      .limit(1)
      .all();
    if (existing[0]) return existing[0];
    const conflict =
      row.record.status === 'settled' &&
      row.record.amountMinor > 0n &&
      (row.requestStatus === 'refund_due' ||
        row.requestStatus === 'cancelled' ||
        row.requestStatus === 'waived' ||
        (row.requestStatus === 'paid' && row.registrationStatus === 'cancelled'));
    if (!conflict) {
      throw new PaymentError('conflict', 'payment record is not an unresolved conflict');
    }
    const refundRows = tx
      .insert(paymentRecords)
      .values({
        createdAt: clock.now(),
        paymentRequestId: row.record.paymentRequestId,
        registrationId: row.record.registrationId,
        collectionId: row.record.collectionId,
        collectionPaymentMethodId: row.record.collectionPaymentMethodId,
        externalReference: row.record.externalReference,
        note,
        amountMinor: row.record.amountMinor,
        currency: row.record.currency,
        status: 'refunded',
        confirmedByUserId: input.actorUserId,
        confirmedAt: clock.now(),
        idempotencyKey
      })
      .returning()
      .all();
    const refund = refundRows[0];
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'payment.mark_refunded',
        targetType: 'payment_record',
        targetId: row.record.id,
        reason: note,
        after: { refundRecordId: refund.id, status: 'refunded' }
      },
      clock
    );
    return refund;
  });
}

function alreadyProcessed(kind: CheckoutSettlement['kind'] = null): CheckoutSettlement {
  return {
    alreadyProcessed: true,
    ignoredUnpaid: false,
    conflict: false,
    kind,
    record: null
  };
}

function markWebhookProcessed(
  tx: DatabaseTransaction,
  stripeEventId: string,
  clock: Clock = systemClock
): void {
  if (!stripeEventId) return;
  tx.update(stripeWebhookEvents)
    .set({ processedAt: clock.now() })
    .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId))
    .run();
}

function jsonPayload(raw: unknown): unknown {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') return JSON.parse(raw) as unknown;
  if (raw instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  }
  return raw;
}
