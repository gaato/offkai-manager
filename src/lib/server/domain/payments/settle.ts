import { and, eq } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  events,
  orders,
  paymentRecords,
  paymentRequests,
  registrations,
  stripeWebhookEvents
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { parseOrderRow } from '$lib/server/domain/orders/row';
import type { Order } from '$lib/server/domain/orders/types';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import type { PaymentRecord } from './requests';
import { PaymentError, SettlementError } from './errors';

export interface SettleCheckoutInput {
  stripeEventId?: string;
  eventType?: string;
  sessionId: string;
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
  kind: 'payment_request' | 'order' | null;
  record: PaymentRecord | null;
  order: Order | null;
}

export interface ExpireCheckoutInput {
  stripeEventId: string;
  eventType?: string;
  sessionId: string;
  stripeAccountId: string;
  raw: unknown;
}

export interface CheckoutExpiration {
  alreadyProcessed: boolean;
  expired: boolean;
  kind: 'payment_request' | 'order' | null;
  order: Order | null;
}

export interface MarkRefundedInput {
  actorUserId: string;
  eventId: string;
  paymentRecordId: string;
  note: string;
}

/** Settles verified Checkout money once, preserving late-arrival conflicts as ledger facts. */
export function settleCheckout(
  client: DatabaseClient,
  input: SettleCheckoutInput
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

  return client.db.transaction(async (tx) => {
    const webhookInserted = await insertWebhookEvent(tx, {
      stripeEventId,
      stripeAccountId: input.stripeAccountId,
      eventType: input.eventType?.trim() || 'checkout.session.completed',
      raw: input.raw
    });

    const requestRows = await tx
      .select({ request: paymentRequests })
      .from(paymentRequests)
      .where(eq(paymentRequests.checkoutSessionId, input.sessionId))
      .limit(1)
      .for('update');
    const request = requestRows[0]?.request;
    if (request) {
      if (!webhookInserted) return alreadyProcessed('payment_request');
      return settlePaymentRequest(tx, request, input, currency, stripeEventId);
    }

    const orderRows = await tx
      .select({ order: orders })
      .from(orders)
      .where(eq(orders.checkoutSessionId, input.sessionId))
      .limit(1)
      .for('update');
    const order = orderRows[0]?.order;
    if (order) {
      if (!webhookInserted) return alreadyProcessed('order', parseOrderRow(order));
      return settleOrder(tx, order, input, currency, stripeEventId);
    }
    if (!webhookInserted) return alreadyProcessed();

    throw new SettlementError(
      'resolution_miss',
      `no payment request or order for checkout session ${input.sessionId}`
    );
  });
}

/** Expires an abandoned campaign Checkout Session without changing event payment requests. */
export function expireCheckout(
  client: DatabaseClient,
  input: ExpireCheckoutInput
): Promise<CheckoutExpiration> {
  const stripeEventId = input.stripeEventId.trim();
  if (!stripeEventId) throw new SettlementError('validation', 'stripe event id is required');
  if (!input.sessionId) throw new SettlementError('validation', 'checkout session id is required');

  return client.db.transaction(async (tx) => {
    const webhookInserted = await insertWebhookEvent(tx, {
      stripeEventId,
      stripeAccountId: input.stripeAccountId,
      eventType: input.eventType?.trim() || 'checkout.session.expired',
      raw: input.raw
    });

    const requestRows = await tx
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.checkoutSessionId, input.sessionId))
      .limit(1);
    if (requestRows[0]) {
      if (!webhookInserted) {
        return {
          alreadyProcessed: true,
          expired: false,
          kind: 'payment_request',
          order: null
        };
      }
      await markWebhookProcessed(tx, stripeEventId);
      return {
        alreadyProcessed: false,
        expired: false,
        kind: 'payment_request',
        order: null
      };
    }

    const orderRows = await tx
      .select({ order: orders })
      .from(orders)
      .where(eq(orders.checkoutSessionId, input.sessionId))
      .limit(1)
      .for('update');
    const current = orderRows[0]?.order;
    if (!current) {
      if (!webhookInserted) {
        return { alreadyProcessed: true, expired: false, kind: null, order: null };
      }
      await markWebhookProcessed(tx, stripeEventId);
      return { alreadyProcessed: false, expired: false, kind: null, order: null };
    }
    if (!webhookInserted) {
      return {
        alreadyProcessed: true,
        expired: false,
        kind: 'order',
        order: parseOrderRow(current)
      };
    }
    if (!['pending', 'payment_pending'].includes(current.status)) {
      await markWebhookProcessed(tx, stripeEventId);
      return {
        alreadyProcessed: false,
        expired: false,
        kind: 'order',
        order: parseOrderRow(current)
      };
    }

    const updatedRows = await tx
      .update(orders)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(orders.id, current.id))
      .returning();
    const updated = parseOrderRow(updatedRows[0]);
    await markWebhookProcessed(tx, stripeEventId);
    await appendAudit(tx, {
      actorUserId: null,
      eventId: null,
      action: 'campaign.pledge_expire',
      targetType: 'order',
      targetId: current.id,
      before: { status: current.status },
      after: { status: updated.status }
    });
    return { alreadyProcessed: false, expired: true, kind: 'order', order: updated };
  });
}

async function settlePaymentRequest(
  tx: DatabaseTransaction,
  request: typeof paymentRequests.$inferSelect,
  input: SettleCheckoutInput,
  currency: string,
  stripeEventId: string
): Promise<CheckoutSettlement> {
  if (request.stripeAccountId && request.stripeAccountId !== input.stripeAccountId) {
    throw new SettlementError('account_mismatch', 'webhook connected account does not match');
  }
  if (input.paymentStatus !== 'paid') {
    await markWebhookProcessed(tx, stripeEventId);
    return {
      alreadyProcessed: false,
      ignoredUnpaid: true,
      conflict: false,
      kind: 'payment_request',
      record: null,
      order: null
    };
  }
  if (request.status === 'paid') {
    await markWebhookProcessed(tx, stripeEventId);
    return alreadyProcessed('payment_request');
  }
  if (input.amountTotal !== request.amountMinor || currency !== request.currency.toUpperCase()) {
    throw new SettlementError('amount_mismatch', 'checkout amount or currency does not match');
  }

  const recordRows = await tx
    .insert(paymentRecords)
    .values({
      paymentRequestId: request.id,
      registrationId: request.registrationId,
      collectionId: request.collectionId,
      collectionPaymentMethodId: request.collectionPaymentMethodId,
      externalReference: input.paymentIntentId ?? '',
      note: '',
      amountMinor: request.amountMinor,
      currency: request.currency,
      status: 'settled',
      confirmedAt: new Date(),
      rawPayloadJson: jsonPayload(input.raw),
      idempotencyKey: stripeEventId
    })
    .returning();
  const record = recordRows[0];
  const conflict = request.status === 'cancelled' || request.status === 'waived';
  if (!conflict) {
    await tx
      .update(paymentRequests)
      .set({
        status: 'paid',
        paymentIntentId: input.paymentIntentId ?? request.paymentIntentId,
        updatedAt: new Date()
      })
      .where(eq(paymentRequests.id, request.id));
  }
  await markWebhookProcessed(tx, stripeEventId);
  await appendAudit(tx, {
    actorUserId: null,
    eventId: request.eventId,
    action: conflict ? 'payment.stripe_settle_conflict' : 'payment.stripe_settle',
    targetType: 'payment_request',
    targetId: request.id,
    before: { status: request.status },
    after: {
      status: conflict ? request.status : 'paid',
      paymentRecordId: record.id,
      amountMinor: record.amountMinor.toString(),
      currency: record.currency,
      conflict
    }
  });
  return {
    alreadyProcessed: false,
    ignoredUnpaid: false,
    conflict,
    kind: 'payment_request',
    record,
    order: null
  };
}

async function settleOrder(
  tx: DatabaseTransaction,
  current: typeof orders.$inferSelect,
  input: SettleCheckoutInput,
  currency: string,
  stripeEventId: string
): Promise<CheckoutSettlement> {
  if (current.stripeAccountId !== input.stripeAccountId) {
    throw new SettlementError('account_mismatch', 'webhook connected account does not match');
  }
  if (input.paymentStatus !== 'paid') {
    await markWebhookProcessed(tx, stripeEventId);
    return {
      alreadyProcessed: false,
      ignoredUnpaid: true,
      conflict: false,
      kind: 'order',
      record: null,
      order: parseOrderRow(current)
    };
  }
  if (current.status === 'paid') {
    await markWebhookProcessed(tx, stripeEventId);
    return alreadyProcessed('order', parseOrderRow(current));
  }
  if (input.amountTotal !== current.amountMinor || currency !== current.currency.toUpperCase()) {
    throw new SettlementError('amount_mismatch', 'checkout amount or currency does not match');
  }

  const paidAt = new Date();
  const conflict = current.status === 'expired' || current.status === 'cancelled';
  const updatedRows = await tx
    .update(orders)
    .set(
      conflict
        ? { paidAt, updatedAt: paidAt }
        : {
            status: 'paid',
            paidAt,
            paymentIntentId: input.paymentIntentId ?? current.paymentIntentId,
            updatedAt: paidAt
          }
    )
    .where(eq(orders.id, current.id))
    .returning();
  const updated = parseOrderRow(updatedRows[0]);
  await markWebhookProcessed(tx, stripeEventId);
  await appendAudit(tx, {
    actorUserId: null,
    eventId: null,
    action: conflict ? 'campaign.stripe_settle_conflict' : 'campaign.pledge_settle',
    targetType: 'order',
    targetId: current.id,
    before: { status: current.status, paidAt: current.paidAt?.toISOString() ?? null },
    after: {
      status: updated.status,
      paidAt: updated.paidAt?.toISOString() ?? null,
      amountMinor: updated.amountMinor.toString(),
      currency: updated.currency,
      conflict
    }
  });
  return {
    alreadyProcessed: false,
    ignoredUnpaid: false,
    conflict,
    kind: 'order',
    record: null,
    order: updated
  };
}

async function insertWebhookEvent(
  tx: DatabaseTransaction,
  input: { stripeEventId: string; stripeAccountId: string; eventType: string; raw: unknown }
): Promise<boolean> {
  if (!input.stripeEventId) return true;
  const inserted = await tx
    .insert(stripeWebhookEvents)
    .values({
      stripeEventId: input.stripeEventId,
      stripeAccountId: input.stripeAccountId,
      eventType: input.eventType,
      payloadJson: jsonPayload(input.raw)
    })
    .onConflictDoNothing({ target: stripeWebhookEvents.stripeEventId })
    .returning({ id: stripeWebhookEvents.id });
  return Boolean(inserted[0]);
}

/** Adds the manual refund fact for one unresolved late-settlement conflict. */
export function markConflictRefunded(
  client: DatabaseClient,
  input: MarkRefundedInput
): Promise<PaymentRecord> {
  const note = input.note.trim();
  if (note.length > 2_000) throw new PaymentError('validation', 'refund note is too long');
  return client.db.transaction(async (tx) => {
    const rows = await tx
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
      .for('update', { of: paymentRecords });
    const row = rows[0];
    if (!row || row.requestEventId !== input.eventId) {
      throw new PaymentError('not_found', 'settlement conflict record not found');
    }
    await authorizeOrganizationRole(tx, row.organizationId, input.actorUserId, 'organizer');

    const idempotencyKey = `manual_refund:${row.record.id}`;
    const existing = await tx
      .select()
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.idempotencyKey, idempotencyKey),
          eq(paymentRecords.status, 'refunded')
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const conflict =
      row.record.status === 'settled' &&
      row.record.amountMinor > 0n &&
      (row.requestStatus === 'cancelled' ||
        row.requestStatus === 'waived' ||
        (row.requestStatus === 'paid' && row.registrationStatus === 'cancelled'));
    if (!conflict) {
      throw new PaymentError('conflict', 'payment record is not an unresolved conflict');
    }

    const refundRows = await tx
      .insert(paymentRecords)
      .values({
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
        confirmedAt: new Date(),
        idempotencyKey
      })
      .returning();
    const refund = refundRows[0];
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      action: 'payment.mark_refunded',
      targetType: 'payment_record',
      targetId: row.record.id,
      reason: note,
      after: { refundRecordId: refund.id, status: 'refunded' }
    });
    return refund;
  });
}

function alreadyProcessed(
  kind: CheckoutSettlement['kind'] = null,
  order: Order | null = null
): CheckoutSettlement {
  return {
    alreadyProcessed: true,
    ignoredUnpaid: false,
    conflict: false,
    kind,
    record: null,
    order
  };
}

async function markWebhookProcessed(tx: DatabaseTransaction, stripeEventId: string): Promise<void> {
  if (!stripeEventId) return;
  await tx
    .update(stripeWebhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
}

function jsonPayload(raw: unknown): unknown {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') return JSON.parse(raw) as unknown;
  if (raw instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  }
  return raw;
}
