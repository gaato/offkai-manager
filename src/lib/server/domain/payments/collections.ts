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
const collectionInstructionsLimit = 10_000;
const methodLabelLimit = 100;
const methodInstructionsLimit = 5_000;

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
  input: CreateCollectionInput
): Promise<Collection> {
  const normalized = validateCollectionInput(input);
  return client.db.transaction(async (tx) => {
    const event = await loadAuthorizedEvent(tx, input.eventId, input.actorUserId, true);
    if (event.archivedAt) throw new CollectionError('illegal_transition', 'event is archived');
    if (await findMainCollection(tx, input.eventId)) {
      throw new CollectionError('conflict', 'event already has an active collection');
    }

    const rows = await tx
      .insert(collections)
      .values({
        eventId: input.eventId,
        ...normalized,
        status: 'draft'
      })
      .returning();
    const collection = parseCollection(rows[0]);
    const methodRows = await tx
      .insert(collectionPaymentMethods)
      .values(
        defaultPaymentMethods.map((method) => ({
          collectionId: collection.id,
          enabled: true,
          ...method
        }))
      )
      .returning({ id: collectionPaymentMethods.id });
    await appendAudit(tx, {
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
    });
    return collection;
  });
}

/** Updates collection settings while preserving started and settled monetary facts. */
export async function updateCollection(
  client: DatabaseClient,
  input: UpdateCollectionInput
): Promise<Collection> {
  const normalized = validateCollectionInput({ ...input, currency: 'JPY' });
  return client.db.transaction(async (tx) => {
    await loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    const current = await requireMainCollection(tx, input.eventId, true);
    if (current.status === 'archived') {
      throw new CollectionError('illegal_transition', 'collection is archived');
    }
    if (current.amountMinor !== normalized.amountMinor) {
      const started = await tx
        .select({ id: paymentRequests.id })
        .from(paymentRequests)
        .where(
          and(
            eq(paymentRequests.collectionId, current.id),
            inArray(paymentRequests.status, ['payment_pending', 'paid'])
          )
        )
        .limit(1);
      const settled = await tx
        .select({ id: paymentRecords.id })
        .from(paymentRecords)
        .where(
          and(eq(paymentRecords.collectionId, current.id), eq(paymentRecords.status, 'settled'))
        )
        .limit(1);
      if (started[0] || settled[0]) {
        throw new CollectionError(
          'amount_frozen',
          'collection amount is frozen by a started payment request or settled payment record'
        );
      }
    }

    const rows = await tx
      .update(collections)
      .set({
        title: normalized.title,
        amountMinor: normalized.amountMinor,
        dueAt: normalized.dueAt,
        instructions: normalized.instructions,
        updatedAt: new Date()
      })
      .where(eq(collections.id, current.id))
      .returning();
    const updated = parseCollection(rows[0]);
    if (current.amountMinor !== updated.amountMinor) {
      await tx
        .update(paymentRequests)
        .set({ amountMinor: updated.amountMinor, dueAt: updated.dueAt, updatedAt: new Date() })
        .where(
          and(
            eq(paymentRequests.collectionId, current.id),
            inArray(paymentRequests.status, ['pending'])
          )
        );
    } else if (current.dueAt?.getTime() !== updated.dueAt?.getTime()) {
      await tx
        .update(paymentRequests)
        .set({ dueAt: updated.dueAt, updatedAt: new Date() })
        .where(
          and(
            eq(paymentRequests.collectionId, current.id),
            inArray(paymentRequests.status, ['pending'])
          )
        );
    }
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      action: 'collection.update',
      targetType: 'collection',
      targetId: current.id,
      before: collectionSettingsAudit(current),
      after: collectionSettingsAudit(updated)
    });
    return updated;
  });
}

export function openCollection(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; reason?: string }
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'open');
}

export function closeCollection(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; reason?: string }
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'closed');
}

export function reopenCollection(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; reason?: string }
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'open');
}

export function archiveCollection(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; reason?: string }
): Promise<Collection> {
  return changeCollectionStatus(client, input, 'archived');
}

export async function upsertPaymentMethod(
  client: DatabaseClient,
  input: UpsertPaymentMethodInput
): Promise<CollectionPaymentMethod> {
  const values = validateMethodInput(input);
  return client.db.transaction(async (tx) => {
    await loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    const collection = await requireMainCollection(tx, input.eventId, true);
    if (collection.status === 'archived') {
      throw new CollectionError('illegal_transition', 'collection is archived');
    }
    const duplicate = await tx
      .select({ id: collectionPaymentMethods.id })
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, collection.id),
          eq(collectionPaymentMethods.label, values.label),
          input.methodId ? ne(collectionPaymentMethods.id, input.methodId) : undefined
        )
      )
      .limit(1);
    if (duplicate[0]) throw new CollectionError('conflict', 'payment method label is in use');

    let before: CollectionPaymentMethod | null = null;
    let row: typeof collectionPaymentMethods.$inferSelect;
    if (input.methodId) {
      const currentRows = await tx
        .select()
        .from(collectionPaymentMethods)
        .where(
          and(
            eq(collectionPaymentMethods.id, input.methodId),
            eq(collectionPaymentMethods.collectionId, collection.id)
          )
        )
        .limit(1)
        .for('update');
      if (!currentRows[0]) throw new CollectionError('not_found', 'payment method not found');
      before = parsePaymentMethod(currentRows[0]);
      const updatedRows = await tx
        .update(collectionPaymentMethods)
        .set(values)
        .where(eq(collectionPaymentMethods.id, input.methodId))
        .returning();
      row = updatedRows[0];
    } else {
      const insertedRows = await tx
        .insert(collectionPaymentMethods)
        .values({ collectionId: collection.id, ...values })
        .returning();
      row = insertedRows[0];
    }
    const method = parsePaymentMethod(row);
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      action: 'payment_method.upsert',
      targetType: 'collection_payment_method',
      targetId: method.id,
      before,
      after: method
    });
    return method;
  });
}

/** Soft-archives a method by disabling it so historical request references stay valid. */
export async function archivePaymentMethod(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; methodId: string }
): Promise<CollectionPaymentMethod> {
  return client.db.transaction(async (tx) => {
    await loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    const collection = await requireMainCollection(tx, input.eventId, true);
    const rows = await tx
      .select()
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.id, input.methodId),
          eq(collectionPaymentMethods.collectionId, collection.id)
        )
      )
      .limit(1)
      .for('update');
    if (!rows[0]) throw new CollectionError('not_found', 'payment method not found');
    const current = parsePaymentMethod(rows[0]);
    if (!current.enabled) return current;

    const updatedRows = await tx
      .update(collectionPaymentMethods)
      .set({ enabled: false })
      .where(eq(collectionPaymentMethods.id, current.id))
      .returning();
    const updated = parsePaymentMethod(updatedRows[0]);
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      action: 'payment_method.archive',
      targetType: 'collection_payment_method',
      targetId: current.id,
      before: current,
      after: updated
    });
    return updated;
  });
}

export async function listPaymentMethods(
  tx: DatabaseTransaction,
  collectionId: string
): Promise<CollectionPaymentMethod[]> {
  const rows = await tx
    .select()
    .from(collectionPaymentMethods)
    .where(eq(collectionPaymentMethods.collectionId, collectionId))
    .orderBy(asc(collectionPaymentMethods.sortOrder), asc(collectionPaymentMethods.id));
  return rows.map(parsePaymentMethod);
}

export async function findMainCollection(
  tx: DatabaseTransaction,
  eventId: string,
  lock = false
): Promise<Collection | null> {
  const query = tx
    .select()
    .from(collections)
    .where(and(eq(collections.eventId, eventId), ne(collections.status, 'archived')))
    .orderBy(asc(collections.createdAt), asc(collections.id))
    .limit(1);
  const rows = lock ? await query.for('update') : await query;
  return rows[0] ? parseCollection(rows[0]) : null;
}

async function changeCollectionStatus(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; reason?: string },
  target: Extract<CollectionStatus, 'open' | 'closed' | 'archived'>
): Promise<Collection> {
  return client.db.transaction(async (tx) => {
    const event = await loadAuthorizedEvent(tx, input.eventId, input.actorUserId);
    if (event.archivedAt) throw new CollectionError('illegal_transition', 'event is archived');
    const current = await requireMainCollection(tx, input.eventId, true);
    if (current.status === target) return current;
    if (!isAllowedCollectionTransition(current.status, target)) {
      throw new CollectionError('illegal_transition', 'collection status transition denied');
    }
    const rows = await tx
      .update(collections)
      .set({ status: target, updatedAt: new Date() })
      .where(and(eq(collections.id, current.id), eq(collections.status, current.status)))
      .returning();
    if (!rows[0]) {
      throw new CollectionError('illegal_transition', 'collection changed concurrently');
    }
    const updated = parseCollection(rows[0]);
    if (updated.status === 'open') await backfillPaymentRequests(tx, updated);
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      action: 'collection.status_change',
      targetType: 'collection',
      targetId: current.id,
      before: { status: current.status },
      after: { status: updated.status },
      reason: input.reason?.trim()
    });
    return updated;
  });
}

function isAllowedCollectionTransition(from: CollectionStatus, to: CollectionStatus): boolean {
  if (from === 'draft') return to === 'open' || to === 'archived';
  if (from === 'open') return to === 'closed';
  if (from === 'closed') return to === 'open' || to === 'archived';
  return false;
}

async function loadAuthorizedEvent(
  tx: DatabaseTransaction,
  eventId: string,
  actorUserId: string,
  lock = false
) {
  const query = tx
    .select({ organizationId: events.organizationId, archivedAt: events.archivedAt })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const rows = lock ? await query.for('update') : await query;
  if (!rows[0]) throw new CollectionError('not_found', 'event not found');
  await authorizeOrganizationRole(tx, rows[0].organizationId, actorUserId, 'organizer');
  return rows[0];
}

async function requireMainCollection(
  tx: DatabaseTransaction,
  eventId: string,
  lock = false
): Promise<Collection> {
  const collection = await findMainCollection(tx, eventId, lock);
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
