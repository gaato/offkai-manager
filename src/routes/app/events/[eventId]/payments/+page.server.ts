import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  archivePaymentMethod,
  closeCollection,
  CollectionError,
  confirmManualPayment,
  createCollection,
  getCollectionDashboard,
  markConflictRefunded,
  openCollection,
  PaymentError,
  reopenCollection,
  updateCollection,
  upsertPaymentMethod,
  waivePaymentRequest
} from '$lib/server/domain/payments';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClock, formatWallClockInput, parseWallClock } from '$lib/server/time';
import { formatMoney } from '$lib/shared/money';
import {
  paymentConfirmationSchema,
  paymentTimingSchema,
  systemPaymentMethodMessageKey
} from '$lib/shared/payment';

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function collectionSchema(t: App.Locals['t']) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('form.validation_required'))
      .max(200, t('form.validation_too_long', { max: 200 })),
    amountYen: z.string().trim().regex(/^\d+$/, t('payments.error_validation')),
    dueAt: z
      .string()
      .trim()
      .refine((value) => value === '' || datetimeLocal.test(value), t('event.validation_datetime')),
    instructions: z.string().max(10_000, t('form.validation_too_long', { max: 10_000 }))
  });
}

function methodSchema(t: App.Locals['t']) {
  return z.object({
    methodId: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      z.uuid().optional()
    ),
    label: z
      .string()
      .trim()
      .min(1, t('form.validation_required'))
      .max(100, t('form.validation_too_long', { max: 100 })),
    timing: paymentTimingSchema,
    confirmation: paymentConfirmationSchema,
    enabled: z.preprocess(
      (value) => value === true || value === 'true' || value === 'on',
      z.boolean()
    ),
    sortOrder: z.preprocess(Number, z.number().int()),
    instructions: z.string().max(5_000, t('form.validation_too_long', { max: 5_000 }))
  });
}

const requestMethodSchema = z.object({ requestId: z.uuid(), methodId: z.uuid() });
const requestSchema = z.object({ requestId: z.uuid() });
const confirmSchema = requestMethodSchema.extend({
  idempotencyKey: z.string().min(1).max(200),
  externalReference: z.string().max(500),
  note: z.string().max(2_000)
});
const waiveSchema = requestSchema.extend({
  idempotencyKey: z.string().min(1).max(200),
  reason: z.string().trim().min(1).max(2_000)
});
const refundSchema = z.object({
  recordId: z.uuid(),
  note: z.string().max(2_000)
});

export const load: PageServerLoad = async (event) => {
  const session = requireSession(event);
  const eventId = routeEventId(event.params.eventId);
  const dashboard = await loadDashboard(event, session.userId, eventId);
  const editId = z.uuid().safeParse(event.url.searchParams.get('editMethod'));
  const editing = editId.success
    ? dashboard.methods.find((method) => method.id === editId.data)
    : undefined;
  const config = getConfig();
  const collection = dashboard.collection;
  const unpaidNames = dashboard.requests
    .filter(({ request }) =>
      ['pending', 'pending_external_creation', 'payment_pending'].includes(request.status)
    )
    .map(({ displayName }) => event.locals.t('payments.reminder_name', { name: displayName }))
    .join('\n');
  const reminder =
    collection && unpaidNames
      ? event.locals.t('payments.reminder_template', {
          event: dashboard.eventTitle,
          amount: formatMoney(collection.amountMinor, collection.currency, event.locals.locale),
          due: collection.dueAt
            ? formatWallClock(collection.dueAt, event.locals.locale, config.time.zone, {
                dateStyle: 'medium',
                timeStyle: 'short'
              })
            : event.locals.t('payments.due_not_set'),
          url: new URL(
            `/events/${encodeURIComponent(dashboard.organizationSlug)}/${encodeURIComponent(dashboard.eventSlug)}`,
            config.auth.publicBaseUrl
          ).toString(),
          names: unpaidNames
        })
      : '';
  return {
    dashboard: {
      collection: collection
        ? {
            title: collection.title,
            status: collection.status,
            amount: formatMoney(collection.amountMinor, collection.currency, event.locals.locale),
            dueAtLabel: collection.dueAt
              ? formatWallClock(collection.dueAt, event.locals.locale, config.time.zone, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })
              : event.locals.t('payments.due_not_set')
          }
        : null,
      amountFrozen: dashboard.amountFrozen,
      metrics: [
        metric('target', dashboard.metrics.targetCount, dashboard.metrics.targetAmountMinor),
        metric('paid', dashboard.metrics.paidCount, dashboard.metrics.paidAmountMinor),
        metric('unpaid', dashboard.metrics.unpaidCount, dashboard.metrics.unpaidAmountMinor),
        metric('waived', dashboard.metrics.waivedCount, dashboard.metrics.waivedAmountMinor)
      ].map(({ key, count, amountMinor }) => ({
        key,
        count,
        amount: formatMoney(amountMinor, collection?.currency ?? 'JPY', event.locals.locale)
      })),
      methods: dashboard.methods.map((method) => ({
        ...method,
        label: localizedMethodText(event, method.label),
        instructions: localizedMethodText(event, method.instructions)
      })),
      requests: dashboard.requests.map((row) => ({
        id: row.request.id,
        displayName: row.displayName,
        status: row.request.status,
        methodLabel: localizedMethodText(event, row.method.label),
        amount: formatMoney(row.request.amountMinor, row.request.currency, event.locals.locale)
      })),
      conflicts: dashboard.conflicts.map((row) => ({
        recordId: row.recordId,
        displayName: row.displayName,
        requestStatus: row.requestStatus,
        amount: formatMoney(row.amountMinor, row.currency, event.locals.locale),
        occurredAt: formatWallClock(row.occurredAt, event.locals.locale, config.time.zone, {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      })),
      consentMissing: dashboard.consentMissing,
      reminder
    },
    collectionForm: await superValidate(
      {
        title: collection?.title ?? '',
        amountYen: collection?.amountMinor.toString() ?? '',
        dueAt: collection?.dueAt ? formatWallClockInput(collection.dueAt, config.time.zone) : '',
        instructions: collection?.instructions ?? ''
      },
      zod4(collectionSchema(event.locals.t))
    ),
    methodForm: await superValidate(
      {
        methodId: editing?.id,
        label: editing ? localizedMethodText(event, editing.label) : '',
        timing: editing?.timing ?? 'onsite',
        confirmation: editing?.confirmation ?? 'manual',
        enabled: editing?.enabled ?? true,
        sortOrder: editing?.sortOrder ?? 10,
        instructions: editing ? localizedMethodText(event, editing.instructions) : ''
      },
      zod4(methodSchema(event.locals.t))
    )
  };

  function metric(
    key: 'target' | 'paid' | 'unpaid' | 'waived',
    count: number,
    amountMinor: bigint
  ) {
    return { key, count, amountMinor };
  }
};

export const actions: Actions = {
  create: async (event) => collectionMutation(event, 'create'),
  update: async (event) => collectionMutation(event, 'update'),
  status: async (event) => {
    const identity = actionIdentity(event);
    const parsed = z
      .object({ target: z.enum(['open', 'closed']) })
      .safeParse(Object.fromEntries(await event.request.formData()));
    if (!parsed.success)
      return fail(400, { actionError: event.locals.t('payments.error_validation') });
    try {
      if (parsed.data.target === 'closed') {
        await closeCollection(getDatabaseClient(getConfig()), identity);
      } else {
        const dashboard = await getCollectionDashboard(getDatabaseClient(getConfig()), identity);
        const transition =
          dashboard.collection?.status === 'closed' ? reopenCollection : openCollection;
        await transition(getDatabaseClient(getConfig()), identity);
      }
      return { actionMessage: event.locals.t('payments.success_status') };
    } catch (cause) {
      return mutationFailure(event, cause, 'change collection status failed');
    }
  },
  upsertMethod: async (event) => {
    const form = await superValidate(event, zod4(methodSchema(event.locals.t)));
    if (!form.valid) return fail(400, { methodForm: form });
    try {
      await upsertPaymentMethod(getDatabaseClient(getConfig()), {
        ...actionIdentity(event),
        ...form.data
      });
      return message(form, event.locals.t('payments.success_method'));
    } catch (cause) {
      logFailure(event, cause, 'upsert payment method failed');
      return message(form, paymentMessage(event, cause), { status: paymentStatus(cause) });
    }
  },
  archiveMethod: async (event) => {
    const parsed = z
      .object({ methodId: z.uuid() })
      .safeParse(Object.fromEntries(await event.request.formData()));
    if (!parsed.success)
      return fail(400, { actionError: event.locals.t('payments.error_validation') });
    try {
      await archivePaymentMethod(getDatabaseClient(getConfig()), {
        ...actionIdentity(event),
        methodId: parsed.data.methodId
      });
      return { actionMessage: event.locals.t('payments.success_method_archive') };
    } catch (cause) {
      return mutationFailure(event, cause, 'archive payment method failed');
    }
  },
  prepareConfirm: async (event) => prepareRequestAction(event, requestMethodSchema, 'confirm'),
  prepareWaive: async (event) => prepareRequestAction(event, requestSchema, 'waive'),
  prepareRefund: async (event) => {
    actionIdentity(event);
    const parsed = z
      .object({ recordId: z.uuid() })
      .safeParse(Object.fromEntries(await event.request.formData()));
    if (!parsed.success)
      return fail(400, { actionError: event.locals.t('payments.error_validation') });
    return { pendingAction: { type: 'refund' as const, ...parsed.data } };
  },
  confirmManual: async (event) => {
    const parsed = confirmSchema.safeParse(Object.fromEntries(await event.request.formData()));
    if (!parsed.success)
      return fail(400, { actionError: event.locals.t('payments.error_validation') });
    try {
      await confirmManualPayment(getDatabaseClient(getConfig()), {
        actorUserId: requireSession(event).userId,
        paymentRequestId: parsed.data.requestId,
        paymentMethodId: parsed.data.methodId,
        idempotencyKey: parsed.data.idempotencyKey,
        externalReference: parsed.data.externalReference,
        note: parsed.data.note
      });
      return { actionMessage: event.locals.t('payments.success_confirm') };
    } catch (cause) {
      return mutationFailure(event, cause, 'confirm manual payment failed');
    }
  },
  waive: async (event) => {
    const parsed = waiveSchema.safeParse(Object.fromEntries(await event.request.formData()));
    if (!parsed.success)
      return fail(400, { actionError: event.locals.t('payments.error_validation') });
    try {
      await waivePaymentRequest(getDatabaseClient(getConfig()), {
        actorUserId: requireSession(event).userId,
        paymentRequestId: parsed.data.requestId,
        idempotencyKey: parsed.data.idempotencyKey,
        reason: parsed.data.reason
      });
      return { actionMessage: event.locals.t('payments.success_waive') };
    } catch (cause) {
      return mutationFailure(event, cause, 'waive payment request failed');
    }
  },
  markRefunded: async (event) => {
    const parsed = refundSchema.safeParse(Object.fromEntries(await event.request.formData()));
    if (!parsed.success)
      return fail(400, { actionError: event.locals.t('payments.error_validation') });
    try {
      const identity = actionIdentity(event);
      await markConflictRefunded(getDatabaseClient(getConfig()), {
        ...identity,
        paymentRecordId: parsed.data.recordId,
        note: parsed.data.note
      });
      return { actionMessage: event.locals.t('payments.success_refunded') };
    } catch (cause) {
      return mutationFailure(event, cause, 'mark settlement conflict refunded failed');
    }
  }
};

async function collectionMutation(event: RequestEvent, operation: 'create' | 'update') {
  const form = await superValidate(event, zod4(collectionSchema(event.locals.t)));
  if (!form.valid) return fail(400, { collectionForm: form });
  const identity = actionIdentity(event);
  const config = getConfig();
  try {
    const values = {
      ...identity,
      title: form.data.title,
      amountMinor: BigInt(form.data.amountYen),
      dueAt: form.data.dueAt ? parseWallClock(form.data.dueAt, config.time.zone) : null,
      instructions: form.data.instructions
    };
    if (operation === 'create') {
      await createCollection(getDatabaseClient(config), { ...values, currency: 'JPY' });
    } else {
      await updateCollection(getDatabaseClient(config), values);
    }
    return message(
      form,
      event.locals.t(operation === 'create' ? 'payments.success_create' : 'payments.success_update')
    );
  } catch (cause) {
    logFailure(event, cause, `${operation} collection failed`);
    return message(form, paymentMessage(event, cause), { status: paymentStatus(cause) });
  }
}

async function prepareRequestAction(
  event: RequestEvent,
  schema: typeof requestSchema | typeof requestMethodSchema,
  type: 'confirm' | 'waive'
) {
  actionIdentity(event);
  const parsed = schema.safeParse(Object.fromEntries(await event.request.formData()));
  if (!parsed.success)
    return fail(400, { actionError: event.locals.t('payments.error_validation') });
  return { pendingAction: { type, ...parsed.data } };
}

async function loadDashboard(event: RequestEvent, actorUserId: string, eventId: string) {
  try {
    return await getCollectionDashboard(getDatabaseClient(getConfig()), { actorUserId, eventId });
  } catch (cause) {
    if (
      (cause instanceof CollectionError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load payment dashboard failed');
    throw error(500);
  }
}

function localizedMethodText(event: RequestEvent, value: string): string {
  const key = systemPaymentMethodMessageKey(value);
  return key ? event.locals.t(key) : value;
}

function actionIdentity(event: RequestEvent) {
  return { actorUserId: requireSession(event).userId, eventId: routeEventId(event.params.eventId) };
}

function routeEventId(raw: string): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw error(404);
  return parsed.data;
}

function mutationFailure(event: RequestEvent, cause: unknown, logMessage: string) {
  logFailure(event, cause, logMessage);
  return fail(paymentStatus(cause), { actionError: paymentMessage(event, cause) });
}

function logFailure(event: RequestEvent, cause: unknown, messageText: string): void {
  event.locals.logger[
    cause instanceof CollectionError ||
    cause instanceof PaymentError ||
    cause instanceof OrganizationError
      ? 'warn'
      : 'error'
  ]({ err: cause }, messageText);
}

function paymentStatus(cause: unknown): 400 | 403 | 404 | 409 | 500 {
  if (cause instanceof OrganizationError) return cause.code === 'forbidden' ? 403 : 404;
  if (cause instanceof CollectionError) {
    if (cause.code === 'validation') return 400;
    if (cause.code === 'not_found') return 404;
    return 409;
  }
  if (cause instanceof PaymentError) {
    if (cause.code === 'validation') return 400;
    if (cause.code === 'not_found') return 404;
    return 409;
  }
  return 500;
}

function paymentMessage(event: RequestEvent, cause: unknown) {
  if (cause instanceof OrganizationError && cause.code === 'forbidden') {
    return event.locals.t('payments.error_forbidden');
  }
  if (cause instanceof CollectionError && cause.code === 'amount_frozen') {
    return event.locals.t('payments.error_frozen');
  }
  if (cause instanceof CollectionError && cause.code === 'illegal_transition') {
    return event.locals.t('payments.error_transition');
  }
  if (
    (cause instanceof CollectionError || cause instanceof PaymentError) &&
    cause.code === 'validation'
  ) {
    return event.locals.t('payments.error_validation');
  }
  if (cause instanceof CollectionError || cause instanceof PaymentError) {
    return event.locals.t('payments.error_conflict');
  }
  return event.locals.t('payments.error_generic');
}
