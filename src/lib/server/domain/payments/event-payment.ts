import { and, eq, inArray, ne } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import type { Clock } from '$lib/server/clock';
import { defaultTuning, type Tuning } from '$lib/server/config';
import {
  collections,
  collectionPaymentMethods,
  events,
  paymentRequests,
  stripeConnectAccounts
} from '$lib/server/db/schema';
import { grossUp, feeBreakdown, effectiveHoldMinutes } from '$lib/shared/fees';
import { paymentRequirementSchema, type PaymentRequirement } from '$lib/shared/payment';
import { EventError } from '../events/errors';
import { backfillPaymentRequests } from './requests';

export type EventPrice =
  { readonly kind: 'pending' } | { readonly kind: 'set'; readonly amountMinor: bigint };

export interface EventPaymentInput {
  paymentRequirement?: PaymentRequirement;
  amountToCollect?: string;
  roundingUnit?: number;
  priceOverride?: string;
  pricePending?: boolean;
  manualCash?: boolean;
  manualPayPay?: boolean;
  holdMinutes?: number;
}

/** Pending is represented by the absence of a non-archived collection, never by a sentinel amount. */
export function eventPrice(tx: DatabaseTransaction, eventId: string): EventPrice {
  const collection = tx
    .select({ amountMinor: collections.amountMinor })
    .from(collections)
    .where(and(eq(collections.eventId, eventId), ne(collections.status, 'archived')))
    .get();
  return collection ? { kind: 'set', amountMinor: collection.amountMinor } : { kind: 'pending' };
}

/** The event's single primary collection is the price; requests snapshot it on admission. */
export function configureEventPayment(
  tx: DatabaseTransaction,
  event: typeof events.$inferSelect,
  input: EventPaymentInput,
  clock: Clock,
  tuning: Tuning = defaultTuning,
  units: number[] = [1, 10, 100]
) {
  const requirement = paymentRequirementSchema.parse(
    input.paymentRequirement ?? event.paymentRequirement
  );
  if (
    input.paymentRequirement === undefined &&
    input.amountToCollect === undefined &&
    input.pricePending === undefined
  )
    return;
  const collection = tx
    .select()
    .from(collections)
    .where(and(eq(collections.eventId, event.id), ne(collections.status, 'archived')))
    .get();
  // Existing collections without the event-level contract keep their original workflow.
  if (requirement === 'none' && event.paymentRequirement === 'none' && collection) return;
  // Once obligations exist, keep their amount, methods, and admission contract stable.
  if (
    collection &&
    tx.select().from(paymentRequests).where(eq(paymentRequests.collectionId, collection.id)).get()
  ) {
    const net = input.amountToCollect ?? event.amountToCollectMinor.toString();
    if (
      requirement !== event.paymentRequirement ||
      net !== event.amountToCollectMinor.toString() ||
      (input.roundingUnit ?? event.roundingUnit) !== event.roundingUnit ||
      (input.priceOverride && input.priceOverride !== collection.amountMinor.toString()) ||
      input.pricePending === true ||
      (input.holdMinutes !== undefined && input.holdMinutes !== event.holdMinutes)
    )
      throw new EventError('payment_frozen', 'payment settings are frozen after registration');
    for (const [method, enabled] of [
      ['cash', input.manualCash],
      ['paypay', input.manualPayPay]
    ] as const) {
      if (enabled !== undefined)
        tx.update(collectionPaymentMethods)
          .set({ enabled })
          .where(
            and(
              eq(collectionPaymentMethods.collectionId, collection.id),
              eq(collectionPaymentMethods.label, `payments.default_method.${method}.label`)
            )
          )
          .run();
    }
    tx.update(collections)
      .set({ dueAt: event.paymentDueAt, updatedAt: clock.now() })
      .where(eq(collections.id, collection.id))
      .run();
    tx.update(paymentRequests)
      .set({ dueAt: event.paymentDueAt, updatedAt: clock.now() })
      .where(
        and(
          eq(paymentRequests.collectionId, collection.id),
          inArray(paymentRequests.status, ['pending', 'payment_pending'])
        )
      )
      .run();
    return;
  }
  try {
    const net = BigInt(input.amountToCollect || '0');
    const unit = input.roundingUnit ?? event.roundingUnit;
    if (!/^\d+$/.test(input.amountToCollect || '0') || net > 99999999n || !units.includes(unit))
      throw new Error('invalid amount or rounding');
    const minutes = effectiveHoldMinutes(
      input.holdMinutes ?? tuning.OFFKAI_HOLD_MINUTES_DEFAULT,
      tuning.OFFKAI_HOLD_MINUTES_MIN,
      tuning.OFFKAI_HOLD_MINUTES_MAX
    );
    const calculated = grossUp(
      net,
      tuning.OFFKAI_STRIPE_FEE_BPS_ESTIMATE,
      event.platformFeeBps,
      unit
    );
    const price = input.priceOverride ? BigInt(input.priceOverride) : calculated;
    if (
      price < 0n ||
      price > 99999999n ||
      (requirement !== 'none' && !input.pricePending && price < 50n)
    )
      throw new Error('invalid price');
    if (requirement !== 'none') {
      const account = tx
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.organizationId, event.organizationId))
        .get();
      if (!account?.chargesEnabled || account.onboardingStatus !== 'ready')
        throw new EventError('validation', 'payout account must be ready');
    }
    tx.update(events)
      .set({
        paymentRequirement: requirement,
        amountToCollectMinor: net,
        roundingUnit: unit,
        holdMinutes: minutes
      })
      .where(eq(events.id, event.id))
      .run();
    if (requirement === 'none') {
      if (collection)
        tx.update(collections)
          .set({ status: 'archived', updatedAt: clock.now() })
          .where(eq(collections.id, collection.id))
          .run();
      return;
    }
    if (input.pricePending) {
      if (requirement !== 'pay_later' || !event.paymentOpensAt)
        throw new Error('pending price requires scheduled pay later');
      if (collection)
        tx.update(collections)
          .set({ status: 'archived', updatedAt: clock.now() })
          .where(eq(collections.id, collection.id))
          .run();
      return;
    }
    const scheduled = event.paymentOpensAt !== null;
    const values = {
      title: event.title,
      amountMinor: price,
      currency: 'JPY',
      status: scheduled ? ('draft' as const) : ('open' as const),
      dueAt: event.paymentDueAt,
      updatedAt: clock.now()
    };
    const saved = collection
      ? tx
          .update(collections)
          .set(values)
          .where(eq(collections.id, collection.id))
          .returning()
          .get()!
      : tx
          .insert(collections)
          .values({ ...values, eventId: event.id, createdAt: clock.now() })
          .returning()
          .get()!;
    const methods = [
      ['card', 'advance', 'internal', true],
      ['cash', 'onsite', 'manual', input.manualCash ?? true],
      ['paypay', 'advance', 'manual', input.manualPayPay ?? true],
      ['waiver', 'none', 'none', true]
    ] as const;
    for (const [name, timing, confirmation, enabled] of methods) {
      const label = `payments.default_method.${name}.label`;
      const existing = tx
        .select()
        .from(collectionPaymentMethods)
        .where(
          and(
            eq(collectionPaymentMethods.collectionId, saved.id),
            eq(collectionPaymentMethods.label, label)
          )
        )
        .get();
      const method = {
        label,
        timing,
        confirmation,
        enabled,
        instructions: `payments.default_method.${name}.instructions`
      };
      if (existing)
        tx.update(collectionPaymentMethods)
          .set(method)
          .where(eq(collectionPaymentMethods.id, existing.id))
          .run();
      else
        tx.insert(collectionPaymentMethods)
          .values({
            ...method,
            collectionId: saved.id,
            sortOrder: methods.findIndex((m) => m[0] === name)
          })
          .run();
    }
    if (saved.status === 'open') backfillPaymentRequests(tx, { ...saved, status: 'open' }, clock);
    feeBreakdown(price, tuning.OFFKAI_STRIPE_FEE_BPS_ESTIMATE, event.platformFeeBps);
  } catch (cause) {
    if (cause instanceof EventError) throw cause;
    throw new EventError('validation', 'invalid payment settings', { cause });
  }
}
