import { systemClock, type Clock } from '$lib/server/clock';
import { write } from '$lib/server/db/client';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  collectionPaymentMethods,
  collections,
  events,
  paymentRecords,
  paymentRequests
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import {
  collectionStatusSchema,
  paymentConfirmationSchema,
  paymentTimingSchema,
  type CollectionStatus,
  type PaymentConfirmation,
  type PaymentTiming
} from '$lib/shared/payment';
import { CollectionError } from './errors';
import { backfillPaymentRequests } from './requests';

const collectionTitleLimit = 200;

const collectionInstructionsLimit = 10000;

const methodLabelLimit = 100;

const methodInstructionsLimit = 5000;

const defaultPaymentMethods = [
  {
    label: 'payments.default_method.card.label',
    timing: 'advance',
    confirmation: 'internal',
    instructions: 'payments.default_method.card.instructions',
    sortOrder: 5
  },
  {
    label: 'payments.default_method.cash.label',
    timing: 'onsite',
    confirmation: 'manual',
    instructions: 'payments.default_method.cash.instructions',
    sortOrder: 10
  },
  {
    label: 'payments.default_method.paypay.label',
    timing: 'onsite',
    confirmation: 'manual',
    instructions: 'payments.default_method.paypay.instructions',
    sortOrder: 20
  },
  {
    label: 'payments.default_method.wise.label',
    timing: 'advance',
    confirmation: 'manual',
    instructions: 'payments.default_method.wise.instructions',
    sortOrder: 30
  },
  {
    label: 'payments.default_method.paypal.label',
    timing: 'advance',
    confirmation: 'manual',
    instructions: 'payments.default_method.paypal.instructions',
    sortOrder: 40
  },
  {
    label: 'payments.default_method.bank.label',
    timing: 'advance',
    confirmation: 'manual',
    instructions: 'payments.default_method.bank.instructions',
    sortOrder: 50
  },
  {
    label: 'payments.default_method.waiver.label',
    timing: 'none',
    confirmation: 'none',
    instructions: 'payments.default_method.waiver.instructions',
    sortOrder: 90
  }
] as const satisfies readonly Omit<
  typeof collectionPaymentMethods.$inferInsert,
  'id' | 'collectionId'
>[];

export interface Collection {
  id: string;
  eventId: string;
  title: string;
  amountMinor: bigint;
  currency: string;
  status: CollectionStatus;
  dueAt: Date | null;
  instructions: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionPaymentMethod {
  id: string;
  collectionId: string;
  label: string;
  timing: PaymentTiming;
  confirmation: PaymentConfirmation;
  enabled: boolean;
  sortOrder: number;
  instructions: string;
}

export interface CreateCollectionInput {
  actorUserId: string;
  eventId: string;
  title: string;
  amountMinor: bigint;
  currency: string;
  dueAt: Date | null;
  instructions: string;
}

export interface UpdateCollectionInput {
  actorUserId: string;
  eventId: string;
  title: string;
  amountMinor: bigint;
  dueAt: Date | null;
  instructions: string;
}

export interface UpsertPaymentMethodInput {
  actorUserId: string;
  eventId: string;
  methodId?: string;
  label: string;
  timing: PaymentTiming;
  confirmation: PaymentConfirmation;
  enabled: boolean;
  sortOrder: number;
  instructions: string;
}

/** Creates the one non-archived collection exposed by the MVP event workflow. */
export async function createCollection(
  client: DatabaseClient,
  input: CreateCollectionInput,
  clock: Clock = systemClock
): Promise<Collection> {
  const normalized = validateCollectionInput(input);
  return write(client, (tx) => {
    const event = loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    if (event.archivedAt) throw new CollectionError('illegal_transition', 'event is archived');
    if (findMainCollection(tx, input.eventId)) {
      throw new CollectionError('conflict', 'event already has an active collection');
    }
    const rows = tx
      .insert(collections)
      .values({
        createdAt: clock.now(),
        updatedAt: clock.now(),
        eventId: input.eventId,
        ...normalized,
        status: 'draft'
      })
      .returning()
      .all();
    const collection = parseCollection(rows[0]);
    const methodRows = tx
      .insert(collectionPaymentMethods)
      .values(
        defaultPaymentMethods.map((method) => ({
          collectionId: collection.id,
          enabled: true,
          ...method
        }))
      )
      .returning({ id: collectionPaymentMethods.id })
      .all();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'collection.create',
        targetType: 'collection',
        targetId: collection.id,
        after: {
          title: collection.title,
          amountMinor: collection.amountMinor.toString(),
          currency: collection.currency,
          dueAt: collection.dueAt,
          status: collection.status,
          defaultMethodIds: methodRows.map(({ id }) => id)
        }
      },
      clock
    );
    return collection;
  });
}

/** Updates collection settings while preserving started and settled monetary facts. */
export async function updateCollection(
  client: DatabaseClient,
  input: UpdateCollectionInput,
  clock: Clock = systemClock
): Promise<Collection> {
  const normalized = validateCollectionInput({ ...input, currency: 'JPY' });
  return write(client, (tx) => {
    const event = loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    const current = requireMainCollection(tx, input.eventId);
    if (current.status === 'archived') {
      throw new CollectionError('illegal_transition', 'collection is archived');
    }
    if (current.amountMinor !== normalized.amountMinor) {
      if (
        event.paymentRequirement !== 'none' &&
        tx.select().from(paymentRequests).where(eq(paymentRequests.collectionId, current.id)).get()
      )
        throw new CollectionError('amount_frozen', 'paid event price is frozen after registration');
      const started = tx
        .select({ id: paymentRequests.id })
        .from(paymentRequests)
        .where(
          and(
            eq(paymentRequests.collectionId, current.id),
            inArray(paymentRequests.status, ['payment_pending', 'paid'])
          )
        )
        .limit(1)
        .all();
      const settled = tx
        .select({ id: paymentRecords.id })
        .from(paymentRecords)
        .where(
          and(eq(paymentRecords.collectionId, current.id), eq(paymentRecords.status, 'settled'))
        )
        .limit(1)
        .all();
      if (started[0] || settled[0]) {
        throw new CollectionError(
          'amount_frozen',
          'collection amount is frozen by a started payment request or settled payment record'
        );
      }
    }
    const rows = tx
      .update(collections)
      .set({
        title: normalized.title,
        amountMinor: normalized.amountMinor,
        dueAt: normalized.dueAt,
        instructions: normalized.instructions,
        updatedAt: clock.now()
      })
      .where(eq(collections.id, current.id))
      .returning()
      .all();
    const updated = parseCollection(rows[0]);
    if (current.amountMinor !== updated.amountMinor) {
      tx.update(paymentRequests)
        .set({ amountMinor: updated.amountMinor, dueAt: updated.dueAt, updatedAt: clock.now() })
        .where(
          and(
            eq(paymentRequests.collectionId, current.id),
            inArray(paymentRequests.status, ['pending'])
          )
        )
        .run();
    } else if (current.dueAt?.getTime() !== updated.dueAt?.getTime()) {
      tx.update(paymentRequests)
        .set({ dueAt: updated.dueAt, updatedAt: clock.now() })
        .where(
          and(
            eq(paymentRequests.collectionId, current.id),
            inArray(paymentRequests.status, ['pending'])
          )
        )
        .run();
    }
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'collection.update',
        targetType: 'collection',
        targetId: current.id,
        before: collectionSettingsAudit(current),
        after: collectionSettingsAudit(updated)
      },
      clock
    );
    return updated;
  });
}

export async function openCollection(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    reason?: string;
  },
  clock: Clock = systemClock
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'open', clock);
}

export async function closeCollection(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    reason?: string;
  },
  clock: Clock = systemClock
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'closed', clock);
}

export async function reopenCollection(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    reason?: string;
  },
  clock: Clock = systemClock
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'open', clock);
}

export async function archiveCollection(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    reason?: string;
  },
  clock: Clock = systemClock
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'archived', clock);
}

export async function upsertPaymentMethod(
  client: DatabaseClient,
  input: UpsertPaymentMethodInput,
  clock: Clock = systemClock
): Promise<CollectionPaymentMethod> {
  const values = validateMethodInput(input);
  return write(client, (tx) => {
    loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    const collection = requireMainCollection(tx, input.eventId);
    if (collection.status === 'archived') {
      throw new CollectionError('illegal_transition', 'collection is archived');
    }
    const duplicate = tx
      .select({ id: collectionPaymentMethods.id })
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, collection.id),
          eq(collectionPaymentMethods.label, values.label),
          input.methodId ? ne(collectionPaymentMethods.id, input.methodId) : undefined
        )
      )
      .limit(1)
      .all();
    if (duplicate[0]) throw new CollectionError('conflict', 'payment method label is in use');
    let before: CollectionPaymentMethod | null = null;
    let row: typeof collectionPaymentMethods.$inferSelect;
    if (input.methodId) {
      const currentRows = tx
        .select()
        .from(collectionPaymentMethods)
        .where(
          and(
            eq(collectionPaymentMethods.id, input.methodId),
            eq(collectionPaymentMethods.collectionId, collection.id)
          )
        )
        .limit(1)
        .all();
      if (!currentRows[0]) throw new CollectionError('not_found', 'payment method not found');
      before = parsePaymentMethod(currentRows[0]);
      const updatedRows = tx
        .update(collectionPaymentMethods)
        .set(values)
        .where(eq(collectionPaymentMethods.id, input.methodId))
        .returning()
        .all();
      row = updatedRows[0];
    } else {
      const insertedRows = tx
        .insert(collectionPaymentMethods)
        .values({ collectionId: collection.id, ...values })
        .returning()
        .all();
      row = insertedRows[0];
    }
    const method = parsePaymentMethod(row);
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'payment_method.upsert',
        targetType: 'collection_payment_method',
        targetId: method.id,
        before,
        after: method
      },
      clock
    );
    return method;
  });
}

/** Soft-archives a method by disabling it so historical request references stay valid. */
export async function archivePaymentMethod(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    methodId: string;
  },
  clock: Clock = systemClock
): Promise<CollectionPaymentMethod> {
  return write(client, (tx) => {
    loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    const collection = requireMainCollection(tx, input.eventId);
    const rows = tx
      .select()
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.id, input.methodId),
          eq(collectionPaymentMethods.collectionId, collection.id)
        )
      )
      .limit(1)
      .all();
    if (!rows[0]) throw new CollectionError('not_found', 'payment method not found');
    const current = parsePaymentMethod(rows[0]);
    if (!current.enabled) return current;
    const updatedRows = tx
      .update(collectionPaymentMethods)
      .set({ enabled: false })
      .where(eq(collectionPaymentMethods.id, current.id))
      .returning()
      .all();
    const updated = parsePaymentMethod(updatedRows[0]);
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'payment_method.archive',
        targetType: 'collection_payment_method',
        targetId: current.id,
        before: current,
        after: updated
      },
      clock
    );
    return updated;
  });
}

export function listPaymentMethods(
  tx: DatabaseTransaction,
  collectionId: string
): CollectionPaymentMethod[] {
  const rows = tx
    .select()
    .from(collectionPaymentMethods)
    .where(eq(collectionPaymentMethods.collectionId, collectionId))
    .orderBy(asc(collectionPaymentMethods.sortOrder), asc(collectionPaymentMethods.id))
    .all();
  return rows.map(parsePaymentMethod);
}

export function findMainCollection(tx: DatabaseTransaction, eventId: string): Collection | null {
  const query = tx
    .select()
    .from(collections)
    .where(and(eq(collections.eventId, eventId), ne(collections.status, 'archived')))
    .orderBy(asc(collections.createdAt), asc(collections.id))
    .limit(1);
  const rows = query.all();
  return rows[0] ? parseCollection(rows[0]) : null;
}

async function changeCollectionStatus(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    reason?: string;
  },
  target: Extract<CollectionStatus, 'open' | 'closed' | 'archived'>,
  clock: Clock = systemClock
): Promise<Collection> {
  return write(client, (tx) => {
    const event = loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    if (event.archivedAt) throw new CollectionError('illegal_transition', 'event is archived');
    const current = requireMainCollection(tx, input.eventId);
    if (current.status === target) return current;
    if (!isAllowedCollectionTransition(current.status, target)) {
      throw new CollectionError('illegal_transition', 'collection status transition denied');
    }
    const rows = tx
      .update(collections)
      .set({ status: target, updatedAt: clock.now() })
      .where(and(eq(collections.id, current.id), eq(collections.status, current.status)))
      .returning()
      .all();
    if (!rows[0]) {
      throw new CollectionError('illegal_transition', 'collection changed concurrently');
    }
    const updated = parseCollection(rows[0]);
    if (updated.status === 'open') backfillPaymentRequests(tx, updated, clock);
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'collection.status_change',
        targetType: 'collection',
        targetId: current.id,
        before: { status: current.status },
        after: { status: updated.status },
        reason: input.reason?.trim()
      },
      clock
    );
    return updated;
  });
}

function isAllowedCollectionTransition(from: CollectionStatus, to: CollectionStatus): boolean {
  if (from === 'draft') return to === 'open' || to === 'archived';
  if (from === 'open') return to === 'closed';
  if (from === 'closed') return to === 'open' || to === 'archived';
  return false;
}

function loadAuthorizedEvent(tx: DatabaseTransaction, eventId: string, actorUserId: string) {
  const query = tx
    .select({
      organizationId: events.organizationId,
      archivedAt: events.archivedAt,
      paymentRequirement: events.paymentRequirement
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const rows = query.all();
  if (!rows[0]) throw new CollectionError('not_found', 'event not found');
  authorizeOrganizationRole(tx, rows[0].organizationId, actorUserId, 'organizer');
  return rows[0];
}

function requireMainCollection(tx: DatabaseTransaction, eventId: string): Collection {
  const collection = findMainCollection(tx, eventId);
  if (!collection) throw new CollectionError('not_found', 'collection not found');
  return collection;
}

function validateCollectionInput(input: {
  title: string;
  amountMinor: bigint;
  currency: string;
  dueAt: Date | null;
  instructions: string;
}) {
  const title = input.title.trim();
  const instructions = input.instructions.trim();
  if (!title || title.length > collectionTitleLimit) {
    throw new CollectionError('validation', 'collection title is invalid');
  }
  if (input.amountMinor < 0n) {
    throw new CollectionError('validation', 'collection amount cannot be negative');
  }
  if (input.currency.trim().toUpperCase() !== 'JPY') {
    throw new CollectionError('validation', 'only JPY collections are supported');
  }
  if (input.dueAt && Number.isNaN(input.dueAt.getTime())) {
    throw new CollectionError('validation', 'collection due date is invalid');
  }
  if (instructions.length > collectionInstructionsLimit) {
    throw new CollectionError('validation', 'collection instructions are too long');
  }
  return {
    title,
    amountMinor: input.amountMinor,
    currency: 'JPY',
    dueAt: input.dueAt,
    instructions
  };
}

function validateMethodInput(input: UpsertPaymentMethodInput) {
  const label = input.label.trim();
  const instructions = input.instructions.trim();
  if (!label || label.length > methodLabelLimit) {
    throw new CollectionError('validation', 'payment method label is invalid');
  }
  if (!Number.isSafeInteger(input.sortOrder)) {
    throw new CollectionError('validation', 'payment method sort order is invalid');
  }
  if (instructions.length > methodInstructionsLimit) {
    throw new CollectionError('validation', 'payment method instructions are too long');
  }
  return {
    label,
    timing: paymentTimingSchema.parse(input.timing),
    confirmation: paymentConfirmationSchema.parse(input.confirmation),
    enabled: input.enabled,
    sortOrder: input.sortOrder,
    instructions
  };
}

function collectionSettingsAudit(collection: Collection) {
  return {
    title: collection.title,
    amountMinor: collection.amountMinor.toString(),
    dueAt: collection.dueAt,
    instructions: collection.instructions
  };
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
