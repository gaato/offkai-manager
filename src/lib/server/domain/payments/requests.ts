import { authorizeDoorStaff, type DoorActor } from '../checkin/access';
import { completeAttendancePayment } from './completion';
import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { and, asc, desc, eq, gt, inArray, isNull, ne, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  collectionPaymentMethods,
  collections,
  eventFormFields,
  events,
  organizations,
  paymentRecords,
  paymentRequests,
  registrations,
  stripeConnectAccounts
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import {
  collectionStatusSchema,
  paymentConfirmationSchema,
  paymentRequestStatusSchema,
  paymentTimingSchema,
  type PaymentRequestStatus
} from '$lib/shared/payment';
import type { Collection, CollectionPaymentMethod } from './collections';
import { CollectionError, PaymentError } from './errors';

export interface PaymentRequest {
  id: string;
  eventId: string;
  collectionId: string;
  registrationId: string;
  collectionPaymentMethodId: string;
  amountMinor: bigint;
  currency: string;
  status: PaymentRequestStatus;
  dueAt: Date | null;
  stripeAccountId: string;
  checkoutSessionId: string;
  paymentIntentId: string;
  chargeType: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentRecord {
  id: string;
  paymentRequestId: string;
  registrationId: string;
  collectionId: string;
  collectionPaymentMethodId: string;
  externalReference: string;
  note: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  rawPayloadJson: unknown;
  idempotencyKey: string;
  createdAt: Date;
}

export interface ConfirmManualPaymentInput {
  actorUserId: string;
  paymentRequestId: string;
  paymentMethodId: string;
  idempotencyKey: string;
  externalReference: string;
  note: string;
}

export interface WaivePaymentInput {
  actorUserId: string;
  paymentRequestId: string;
  idempotencyKey: string;
  reason: string;
}

export interface PaymentRequestRow {
  request: PaymentRequest;
  displayName: string;
  method: CollectionPaymentMethod;
}

export interface CollectionMetrics {
  targetCount: number;
  targetAmountMinor: bigint;
  paidCount: number;
  paidAmountMinor: bigint;
  unpaidCount: number;
  unpaidAmountMinor: bigint;
  waivedCount: number;
  waivedAmountMinor: bigint;
}

export interface CollectionDashboard {
  eventTitle: string;
  eventSlug: string;
  organizationSlug: string;
  collection: Collection | null;
  methods: CollectionPaymentMethod[];
  requests: PaymentRequestRow[];
  metrics: CollectionMetrics;
  amountFrozen: boolean;
  conflicts: SettleConflictRow[];
  consentMissing: boolean;
}

export interface SettleConflictRow {
  recordId: string;
  paymentRequestId: string;
  displayName: string;
  amountMinor: bigint;
  currency: string;
  paymentIntentId: string;
  requestStatus: PaymentRequestStatus;
  occurredAt: Date;
}

export interface GlobalSettleConflictRow extends SettleConflictRow {
  organizationId: string;
  organizationName: string;
  eventId: string;
  eventTitle: string;
}

export interface ParticipantPaymentDetail {
  amountMinor: bigint;
  currency: string;
  dueAt: Date | null;
  collectionTitle: string;
  collectionInstructions: string;
  methodLabel: string;
  methodInstructions: string;
  methodConfirmation: CollectionPaymentMethod['confirmation'];
  status: PaymentRequestStatus;
  canCheckout: boolean;
  paidAt: Date | null;
}

/** Loads the main collection and participant obligations for staff and organizers. */
export async function getCollectionDashboard(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
  }
): Promise<CollectionDashboard> {
  return read(client, (tx) => {
    const eventRows = tx
      .select({
        organizationId: events.organizationId,
        eventTitle: events.title,
        eventSlug: events.slug,
        organizationSlug: organizations.slug
      })
      .from(events)
      .innerJoin(organizations, eq(organizations.id, events.organizationId))
      .where(eq(events.id, input.eventId))
      .limit(1)
      .all();
    if (!eventRows[0]) throw new CollectionError('not_found', 'event not found');
    authorizeOrganizationRole(tx, eventRows[0].organizationId, input.actorUserId, 'staff', true);
    const collectionRows = tx
      .select()
      .from(collections)
      .where(and(eq(collections.eventId, input.eventId), ne(collections.status, 'archived')))
      .orderBy(asc(collections.createdAt), asc(collections.id))
      .limit(1)
      .all();
    if (!collectionRows[0]) return emptyDashboard();
    const collection = parseCollection(collectionRows[0]);
    const methodRows = tx
      .select()
      .from(collectionPaymentMethods)
      .where(eq(collectionPaymentMethods.collectionId, collection.id))
      .orderBy(asc(collectionPaymentMethods.sortOrder), asc(collectionPaymentMethods.id))
      .all();
    const methods = methodRows.map(parsePaymentMethod);
    const rows = tx
      .select({
        request: paymentRequests,
        displayName: registrations.displayNameSnapshot,
        method: collectionPaymentMethods
      })
      .from(paymentRequests)
      .innerJoin(registrations, eq(registrations.id, paymentRequests.registrationId))
      .innerJoin(
        collectionPaymentMethods,
        eq(collectionPaymentMethods.id, paymentRequests.collectionPaymentMethodId)
      )
      .where(eq(paymentRequests.collectionId, collection.id))
      .orderBy(asc(registrations.createdAt), asc(registrations.id))
      .all();
    const requests = rows.map((row) => ({
      request: parsePaymentRequest(row.request),
      displayName: row.displayName,
      method: parsePaymentMethod(row.method)
    }));
    const settledRows = tx
      .select({ id: paymentRecords.id })
      .from(paymentRecords)
      .where(
        and(eq(paymentRecords.collectionId, collection.id), eq(paymentRecords.status, 'settled'))
      )
      .limit(1)
      .all();
    const startedRows = tx
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.collectionId, collection.id),
          inArray(paymentRequests.status, ['payment_pending', 'paid'])
        )
      )
      .limit(1)
      .all();
    const conflictRows = listUnresolvedSettleConflicts(tx, {
      eventId: input.eventId,
      newestFirst: false
    });
    const consentRows = tx
      .select({ id: eventFormFields.id })
      .from(eventFormFields)
      .where(
        and(
          eq(eventFormFields.eventId, input.eventId),
          eq(eventFormFields.fieldType, 'consent'),
          isNull(eventFormFields.archivedAt)
        )
      )
      .limit(1)
      .all();
    return {
      eventTitle: eventRows[0].eventTitle,
      eventSlug: eventRows[0].eventSlug,
      organizationSlug: eventRows[0].organizationSlug,
      collection,
      methods,
      requests,
      metrics: collectionMetrics(requests),
      amountFrozen: Boolean(startedRows[0] || settledRows[0]),
      conflicts: conflictRows,
      consentMissing: collection.status === 'open' && collection.amountMinor > 0n && !consentRows[0]
    };
  });
}

export function listUnresolvedSettleConflicts(
  tx: DatabaseTransaction,
  options: {
    eventId?: string;
    newestFirst?: boolean;
  } = {}
): GlobalSettleConflictRow[] {
  const refundRecords = alias(paymentRecords, 'refund_records');
  const rows = tx
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      eventId: events.id,
      eventTitle: events.title,
      recordId: paymentRecords.id,
      paymentRequestId: paymentRecords.paymentRequestId,
      displayName: registrations.displayNameSnapshot,
      amountMinor: paymentRecords.amountMinor,
      currency: paymentRecords.currency,
      paymentIntentId: paymentRecords.externalReference,
      requestStatus: paymentRequests.status,
      occurredAt: paymentRecords.createdAt
    })
    .from(paymentRecords)
    .innerJoin(paymentRequests, eq(paymentRequests.id, paymentRecords.paymentRequestId))
    .innerJoin(registrations, eq(registrations.id, paymentRecords.registrationId))
    .innerJoin(events, eq(events.id, paymentRequests.eventId))
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(
      and(
        options.eventId ? eq(paymentRequests.eventId, options.eventId) : undefined,
        eq(paymentRecords.status, 'settled'),
        gt(paymentRecords.amountMinor, 0n),
        or(
          inArray(paymentRequests.status, ['cancelled', 'waived', 'refund_due']),
          and(eq(paymentRequests.status, 'paid'), eq(registrations.status, 'cancelled'))
        ),
        notExists(
          tx
            .select({ id: refundRecords.id })
            .from(refundRecords)
            .where(
              and(
                eq(refundRecords.status, 'refunded'),
                eq(
                  refundRecords.idempotencyKey,
                  sql<string>`'manual_refund:' || ${paymentRecords.id}`
                )
              )
            )
        )
      )
    )
    .orderBy(
      options.newestFirst ? desc(paymentRecords.createdAt) : asc(paymentRecords.createdAt),
      options.newestFirst ? desc(paymentRecords.id) : asc(paymentRecords.id)
    )
    .all();
  return rows.map((row) => ({
    ...row,
    requestStatus: paymentRequestStatusSchema.parse(row.requestStatus)
  }));
}

/** Returns an active obligation only to the participant who owns the registration. */
export async function getParticipantPaymentDetail(
  client: DatabaseClient,
  registrationId: string,
  userId: string
): Promise<ParticipantPaymentDetail | null> {
  return read(client, (tx) => {
    const rows = tx
      .select({
        request: paymentRequests,
        collection: collections,
        method: collectionPaymentMethods,
        eventCancelledAt: events.cancelledAt,
        eventArchivedAt: events.archivedAt,
        organizationSuspendedAt: organizations.suspendedAt,
        connectStatus: stripeConnectAccounts.onboardingStatus,
        chargesEnabled: stripeConnectAccounts.chargesEnabled
      })
      .from(paymentRequests)
      .innerJoin(registrations, eq(registrations.id, paymentRequests.registrationId))
      .innerJoin(collections, eq(collections.id, paymentRequests.collectionId))
      .innerJoin(events, eq(events.id, paymentRequests.eventId))
      .innerJoin(organizations, eq(organizations.id, events.organizationId))
      .innerJoin(
        collectionPaymentMethods,
        eq(collectionPaymentMethods.id, paymentRequests.collectionPaymentMethodId)
      )
      .leftJoin(
        stripeConnectAccounts,
        eq(stripeConnectAccounts.organizationId, events.organizationId)
      )
      .where(
        and(
          eq(paymentRequests.registrationId, registrationId),
          eq(registrations.userId, userId),
          inArray(paymentRequests.status, [
            'pending',
            'payment_pending',
            'paid',
            'waived',
            'cancelled'
          ]),
          ne(collections.status, 'archived')
        )
      )
      .orderBy(asc(collections.createdAt), asc(collections.id))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row) return null;
    const settledRows =
      row.request.status === 'paid'
        ? tx
            .select({ confirmedAt: paymentRecords.confirmedAt })
            .from(paymentRecords)
            .where(
              and(
                eq(paymentRecords.paymentRequestId, row.request.id),
                eq(paymentRecords.status, 'settled')
              )
            )
            .orderBy(desc(paymentRecords.confirmedAt), desc(paymentRecords.createdAt))
            .limit(1)
            .all()
        : [];
    return {
      amountMinor: row.request.amountMinor,
      currency: row.request.currency,
      dueAt: row.request.dueAt,
      collectionTitle: row.collection.title,
      collectionInstructions: row.collection.instructions,
      methodLabel: row.method.label,
      methodInstructions: row.method.instructions,
      methodConfirmation: paymentConfirmationSchema.parse(row.method.confirmation),
      status: paymentRequestStatusSchema.parse(row.request.status),
      canCheckout:
        row.method.enabled &&
        row.method.confirmation === 'internal' &&
        row.collection.status === 'open' &&
        !row.eventCancelledAt &&
        !row.eventArchivedAt &&
        !row.organizationSuspendedAt &&
        row.connectStatus === 'ready' &&
        row.chargesEnabled === true &&
        ['pending', 'payment_pending'].includes(row.request.status),
      paidAt: settledRows[0]?.confirmedAt ?? null
    };
  });
}

/** Adds missing request snapshots for all confirmed registrations in one open collection. */
export function backfillPaymentRequests(
  tx: DatabaseTransaction,
  collection: Collection,
  clock: Clock = systemClock
): PaymentRequest[] {
  if (collection.status !== 'open') {
    throw new CollectionError('illegal_transition', 'collection must be open');
  }
  const methodId = defaultPaymentMethodId(tx, collection.id);
  const confirmedRows = tx
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(eq(registrations.eventId, collection.eventId), eq(registrations.status, 'confirmed'))
    )
    .all();
  if (confirmedRows.length === 0) return [];
  const rows = tx
    .insert(paymentRequests)
    .values(
      confirmedRows
        .map(({ id }) => ({
          eventId: collection.eventId,
          collectionId: collection.id,
          registrationId: id,
          collectionPaymentMethodId: methodId,
          applicationFeeAmount:
            (collection.amountMinor *
              BigInt(
                tx.select().from(events).where(eq(events.id, collection.eventId)).get()!
                  .platformFeeBps
              )) /
            10000n,
          amountMinor: collection.amountMinor,
          currency: collection.currency,
          status: 'pending',
          dueAt: collection.dueAt
        }))
        .map((row) => ({ createdAt: clock.now(), updatedAt: clock.now(), ...row }))
    )
    .onConflictDoNothing({
      target: [paymentRequests.collectionId, paymentRequests.registrationId]
    })
    .returning()
    .all();
  return rows.map(parsePaymentRequest);
}

/** Creates a request snapshot when one confirmed registration enters an open collection. */
export function ensurePaymentRequestsForRegistration(
  tx: DatabaseTransaction,
  eventId: string,
  registrationId: string,
  clock: Clock = systemClock
): PaymentRequest[] {
  const collectionRows = tx
    .select()
    .from(collections)
    .where(and(eq(collections.eventId, eventId), eq(collections.status, 'open')))
    .orderBy(asc(collections.createdAt), asc(collections.id))
    .all();
  const created: PaymentRequest[] = [];
  for (const row of collectionRows) {
    const collection: Collection = {
      ...row,
      status: 'open'
    };
    const methodId = defaultPaymentMethodId(tx, collection.id);
    const rows = tx
      .insert(paymentRequests)
      .values({
        createdAt: clock.now(),
        updatedAt: clock.now(),
        eventId,
        collectionId: collection.id,
        registrationId,
        collectionPaymentMethodId: methodId,
        applicationFeeAmount:
          (collection.amountMinor *
            BigInt(
              tx.select().from(events).where(eq(events.id, collection.eventId)).get()!
                .platformFeeBps
            )) /
          10000n,
        amountMinor: collection.amountMinor,
        currency: collection.currency,
        status: 'pending',
        dueAt: collection.dueAt
      })
      .onConflictDoNothing({
        target: [paymentRequests.collectionId, paymentRequests.registrationId]
      })
      .returning()
      .all();
    if (rows[0]) created.push(parsePaymentRequest(rows[0]));
  }
  return created;
}

/** Cancels only non-terminal request states, preserving paid and waived facts. */
export function cancelPaymentRequestsForRegistration(
  tx: DatabaseTransaction,
  registrationId: string,
  clock: Clock = systemClock
): string[] {
  const rows = tx
    .update(paymentRequests)
    .set({ status: 'cancelled', updatedAt: clock.now() })
    .where(
      and(
        eq(paymentRequests.registrationId, registrationId),
        inArray(paymentRequests.status, ['pending', 'payment_pending'])
      )
    )
    .returning({ id: paymentRequests.id })
    .all();
  tx.update(paymentRequests)
    .set({ status: 'refund_due', updatedAt: clock.now() })
    .where(
      and(eq(paymentRequests.registrationId, registrationId), eq(paymentRequests.status, 'paid'))
    )
    .run();
  return rows.map(({ id }) => id);
}

/** Records a manually verified payment with command idempotency. */
export async function confirmManualPayment(
  client: DatabaseClient,
  input: ConfirmManualPaymentInput,
  clock: Clock = systemClock
): Promise<PaymentRecord> {
  return write(client, (tx) => confirmManualPaymentInTransaction(tx, input, clock));
}

export function confirmManualPaymentInTransaction(
  tx: DatabaseTransaction,
  input: ConfirmManualPaymentInput,
  clock: Clock,
  doorActor?: DoorActor
): PaymentRecord {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);

  const context = loadRequestContext(
    tx,
    input.paymentRequestId,
    input.actorUserId,
    'staff',
    doorActor
  );
  const existing = findRecordByIdempotencyKey(tx, idempotencyKey);
  if (existing) {
    if (
      existing.paymentRequestId === context.request.id &&
      existing.collectionPaymentMethodId === input.paymentMethodId &&
      existing.status === 'settled'
    ) {
      return existing;
    }
    throw new PaymentError('conflict', 'idempotency key belongs to another payment operation');
  }
  ensurePayable(context.request);
  const methodRows = tx
    .select()
    .from(collectionPaymentMethods)
    .where(
      and(
        eq(collectionPaymentMethods.id, input.paymentMethodId),
        eq(collectionPaymentMethods.collectionId, context.request.collectionId)
      )
    )
    .limit(1)
    .all();
  const method = methodRows[0];
  if (!method || !method.enabled || method.confirmation !== 'manual') {
    throw new PaymentError('invalid_method', 'payment method cannot confirm manual payments');
  }
  const record = insertSettledRecord(
    tx,
    {
      request: context.request,
      paymentMethodId: method.id,
      amountMinor: context.request.amountMinor,
      actorUserId: input.actorUserId,
      externalReference: input.externalReference.trim(),
      note: input.note.trim(),
      idempotencyKey
    },
    clock
  );
  tx.update(paymentRequests)
    .set({ status: 'paid', updatedAt: clock.now() })
    .where(eq(paymentRequests.id, context.request.id))
    .run();
  completeAttendancePayment(tx, context.request, clock, record.id, 'paid');
  appendAudit(
    tx,
    {
      actorUserId: input.actorUserId,
      eventId: context.request.eventId,
      action: 'payment.confirm_manual',
      targetType: 'payment_request',
      targetId: context.request.id,
      before: { status: context.request.status },
      after: {
        status: 'paid',
        paymentRecordId: record.id,
        amountMinor: record.amountMinor.toString(),
        currency: record.currency,
        paymentMethodId: record.collectionPaymentMethodId,
        hasExternalReference: record.externalReference.length > 0
      }
    },
    clock
  );
  return record;
}

/** Records a zero-value settlement under the collection's enabled waiver method. */
export async function waivePaymentRequest(
  client: DatabaseClient,
  input: WaivePaymentInput,
  clock: Clock = systemClock
): Promise<PaymentRecord> {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  return write(client, (tx) => {
    const context = loadRequestContext(tx, input.paymentRequestId, input.actorUserId, 'organizer');
    const existing = findRecordByIdempotencyKey(tx, idempotencyKey);
    if (existing) {
      if (
        existing.paymentRequestId === context.request.id &&
        existing.amountMinor === 0n &&
        existing.status === 'settled'
      ) {
        return existing;
      }
      throw new PaymentError('conflict', 'idempotency key belongs to another payment operation');
    }
    ensurePayable(context.request);
    const waiverRows = tx
      .select({ id: collectionPaymentMethods.id })
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, context.request.collectionId),
          eq(collectionPaymentMethods.enabled, true),
          eq(collectionPaymentMethods.timing, 'none'),
          eq(collectionPaymentMethods.confirmation, 'none')
        )
      )
      .orderBy(asc(collectionPaymentMethods.sortOrder), asc(collectionPaymentMethods.id))
      .limit(1)
      .all();
    if (!waiverRows[0]) {
      throw new PaymentError('invalid_method', 'collection has no enabled waiver method');
    }
    const record = insertSettledRecord(
      tx,
      {
        request: context.request,
        paymentMethodId: waiverRows[0].id,
        amountMinor: 0n,
        actorUserId: input.actorUserId,
        externalReference: '',
        note: input.reason.trim(),
        idempotencyKey
      },
      clock
    );
    tx.update(paymentRequests)
      .set({ status: 'waived', updatedAt: clock.now() })
      .where(eq(paymentRequests.id, context.request.id))
      .run();
    completeAttendancePayment(tx, context.request, clock, record.id, 'waived');
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: context.request.eventId,
        action: 'payment.waive',
        targetType: 'payment_request',
        targetId: context.request.id,
        before: {
          status: context.request.status,
          amountMinor: context.request.amountMinor.toString()
        },
        after: {
          status: 'waived',
          paymentRecordId: record.id,
          amountMinor: '0',
          currency: record.currency,
          paymentMethodId: record.collectionPaymentMethodId
        },
        reason: input.reason.trim()
      },
      clock
    );
    return record;
  });
}

function defaultPaymentMethodId(tx: DatabaseTransaction, collectionId: string): string {
  const rows = tx
    .select({ id: collectionPaymentMethods.id })
    .from(collectionPaymentMethods)
    .where(
      and(
        eq(collectionPaymentMethods.collectionId, collectionId),
        eq(collectionPaymentMethods.enabled, true),
        ne(collectionPaymentMethods.timing, 'none')
      )
    )
    .orderBy(asc(collectionPaymentMethods.sortOrder), asc(collectionPaymentMethods.id))
    .limit(1)
    .all();
  if (!rows[0]) {
    throw new CollectionError('validation', 'collection has no enabled payment method');
  }
  return rows[0].id;
}

function loadRequestContext(
  tx: DatabaseTransaction,
  requestId: string,
  actorUserId: string,
  role: 'staff' | 'organizer',
  doorActor?: DoorActor
) {
  const rows = tx
    .select({ request: paymentRequests, collection: collections, event: events })
    .from(paymentRequests)
    .innerJoin(collections, eq(collections.id, paymentRequests.collectionId))
    .innerJoin(events, eq(events.id, paymentRequests.eventId))
    .where(eq(paymentRequests.id, requestId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) throw new PaymentError('not_found', 'payment request not found');
  if (doorActor) {
    if (doorActor.actorUserId !== actorUserId)
      throw new PaymentError('not_payable', 'actor mismatch');
    authorizeDoorStaff(tx, row.event.id, doorActor);
  } else authorizeOrganizationRole(tx, row.event.organizationId, actorUserId, role);
  if (row.event.archivedAt || row.collection.status === 'archived') {
    throw new PaymentError('not_payable', 'payment request belongs to an archived scope');
  }
  return { request: parsePaymentRequest(row.request) };
}

function ensurePayable(request: PaymentRequest): void {
  if (request.status !== 'pending' && request.status !== 'payment_pending') {
    throw new PaymentError('not_payable', 'payment request is terminal');
  }
}

function findRecordByIdempotencyKey(
  tx: DatabaseTransaction,
  idempotencyKey: string
): PaymentRecord | null {
  const rows = tx
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.idempotencyKey, idempotencyKey))
    .limit(1)
    .all();
  return rows[0] ? parsePaymentRecord(rows[0]) : null;
}

function insertSettledRecord(
  tx: DatabaseTransaction,
  input: {
    request: PaymentRequest;
    paymentMethodId: string;
    amountMinor: bigint;
    actorUserId: string;
    externalReference: string;
    note: string;
    idempotencyKey: string;
  },
  clock: Clock = systemClock
): PaymentRecord {
  const rows = tx
    .insert(paymentRecords)
    .values({
      createdAt: clock.now(),
      paymentRequestId: input.request.id,
      registrationId: input.request.registrationId,
      collectionId: input.request.collectionId,
      collectionPaymentMethodId: input.paymentMethodId,
      externalReference: input.externalReference,
      note: input.note,
      amountMinor: input.amountMinor,
      currency: input.request.currency,
      status: 'settled',
      confirmedByUserId: input.actorUserId,
      confirmedAt: clock.now(),
      idempotencyKey: input.idempotencyKey
    })
    .returning()
    .all();
  return parsePaymentRecord(rows[0]);
}

function requireIdempotencyKey(raw: string): string {
  const key = raw.trim();
  if (!key || key.length > 200) {
    throw new PaymentError('validation', 'idempotency key is required');
  }
  return key;
}

function parsePaymentRequest(row: typeof paymentRequests.$inferSelect): PaymentRequest {
  return { ...row, status: paymentRequestStatusSchema.parse(row.status) };
}

function parsePaymentRecord(row: typeof paymentRecords.$inferSelect): PaymentRecord {
  return row;
}

function parseCollection(row: typeof collections.$inferSelect): Collection {
  return { ...row, status: collectionStatusSchema.parse(row.status) };
}

function parsePaymentMethod(
  row: typeof collectionPaymentMethods.$inferSelect
): CollectionPaymentMethod {
  return {
    ...row,
    timing: paymentTimingSchema.parse(row.timing),
    confirmation: paymentConfirmationSchema.parse(row.confirmation)
  };
}

function emptyDashboard(): CollectionDashboard {
  return {
    eventTitle: '',
    eventSlug: '',
    organizationSlug: '',
    collection: null,
    methods: [],
    requests: [],
    metrics: {
      targetCount: 0,
      targetAmountMinor: 0n,
      paidCount: 0,
      paidAmountMinor: 0n,
      unpaidCount: 0,
      unpaidAmountMinor: 0n,
      waivedCount: 0,
      waivedAmountMinor: 0n
    },
    amountFrozen: false,
    conflicts: [],
    consentMissing: false
  };
}

function collectionMetrics(rows: readonly PaymentRequestRow[]): CollectionMetrics {
  const metrics = emptyDashboard().metrics;
  for (const { request } of rows) {
    if (request.status !== 'cancelled') {
      metrics.targetCount += 1;
      metrics.targetAmountMinor += request.amountMinor;
    }
    if (request.status === 'paid') {
      metrics.paidCount += 1;
      metrics.paidAmountMinor += request.amountMinor;
    } else if (request.status === 'waived') {
      metrics.waivedCount += 1;
      metrics.waivedAmountMinor += request.amountMinor;
    } else if (request.status === 'pending' || request.status === 'payment_pending') {
      metrics.unpaidCount += 1;
      metrics.unpaidAmountMinor += request.amountMinor;
    }
  }
  return metrics;
}
