import { eventPaymentFields } from '$lib/shared/event-payment-form';
import { getConnectAccount, getCollectionDashboard } from '$lib/server/domain/payments';
import { paymentRequirementSchema } from '$lib/shared/payment';
import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { EventError, updateSettings } from '$lib/server/domain/events';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClockInput } from '$lib/server/time';
import { registrationModeSchema, venueRevealSchema } from '$lib/shared/event';
const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
function settingsSchema(t: App.Locals['t']) {
  const datetime = z.string().regex(datetimeLocal, t('event.validation_datetime'));
  return z.object({
    ...eventPaymentFields(t('payments.error_validation')),
    title: z
      .string()
      .trim()
      .min(1, t('form.validation_required'))
      .max(200, t('form.validation_too_long', { max: 200 })),
    description: z.string().max(10_000, t('form.validation_too_long', { max: 10_000 })),
    startsAt: datetime,
    endsAt: datetime,
    capacity: z.preprocess(
      (value) => (value === '' || value === undefined || value === null ? null : Number(value)),
      z.number().int().positive(t('event.validation_capacity')).nullable()
    ),
    registrationOpensAt: datetime,
    registrationClosesAt: datetime,
    venueName: z.string().max(300, t('form.validation_too_long', { max: 300 })),
    venueAddress: z.string().max(500, t('form.validation_too_long', { max: 500 })),
    venueReveal: venueRevealSchema,
    contact: z.string().max(500, t('form.validation_too_long', { max: 500 })),
    cancellationPolicy: z.string().max(5_000, t('form.validation_too_long', { max: 5_000 })),
    registrationMode: registrationModeSchema
  });
}

export const load: PageServerLoad = async (event) => {
  const data = await event.parent();
  const { locals } = event;
  const config = getConfig();
  const item = data.event;
  const session = requireSession(event);
  const client = getDatabaseClient(config);
  const account = await getConnectAccount(client, item.organizationId, session);
  const payments = await getCollectionDashboard(client, {
    actorUserId: session.userId,
    eventId: item.id
  });
  return {
    paymentUi: {
      ready: account?.onboardingStatus === 'ready',
      stripeBps: config.tuning.OFFKAI_STRIPE_FEE_BPS_ESTIMATE,
      platformBps: item.platformFeeBps,
      units: config.priceRoundingUnits,
      holdMin: config.tuning.OFFKAI_HOLD_MINUTES_MIN,
      holdMax: config.tuning.OFFKAI_HOLD_MINUTES_MAX
    },
    timeZone: config.time.zone,
    form: await superValidate(
      {
        paymentRequirement: paymentRequirementSchema.parse(item.paymentRequirement),
        amountToCollect: item.amountToCollectMinor.toString(),
        roundingUnit: item.roundingUnit,
        priceOverride: payments.collection?.amountMinor.toString() ?? '',
        manualCash:
          payments.methods.find((m) => m.label === 'payments.default_method.cash.label')?.enabled ??
          true,
        manualPayPay:
          payments.methods.find((m) => m.label === 'payments.default_method.paypay.label')
            ?.enabled ?? true,
        holdMinutes: item.holdMinutes,
        title: item.title,
        description: item.description,
        startsAt: formatWallClockInput(item.startsAt, config.time.zone),
        endsAt: formatWallClockInput(item.endsAt, config.time.zone),
        capacity: item.capacity,
        registrationOpensAt: formatWallClockInput(item.registrationOpensAt, config.time.zone),
        registrationClosesAt: formatWallClockInput(item.registrationClosesAt, config.time.zone),
        venueName: item.venueName,
        venueAddress: item.venueAddress,
        venueReveal: item.venueReveal,
        contact: item.contact,
        cancellationPolicy: item.cancellationPolicy,
        registrationMode: item.registrationMode
      },
      zod4(settingsSchema(locals.t))
    )
  };
};
export const actions: Actions = {
  settings: async (event) => {
    const session = requireSession(event);
    const eventId = z.uuid().safeParse(event.params.eventId);
    if (!eventId.success) throw error(404);
    const form = await superValidate(event, zod4(settingsSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    const config = getConfig();
    try {
      await updateSettings(
        getDatabaseClient(config),
        {
          actorUserId: session.userId,
          eventId: eventId.data,
          ...form.data,
          timeZone: config.time.zone
        },
        undefined,
        config.tuning,
        config.priceRoundingUnits
      );
      return message(form, event.locals.t('event.settings_success'));
    } catch (cause) {
      event.locals.logger[
        cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'update event settings failed');
      const key =
        cause instanceof EventError && cause.code === 'illegal_transition'
          ? 'event.error_illegal_transition'
          : cause instanceof EventError && cause.code === 'validation'
            ? 'event.error_validation'
            : cause instanceof OrganizationError && cause.code === 'forbidden'
              ? 'event.error_forbidden'
              : 'event.error_generic';
      const status =
        cause instanceof EventError && cause.code === 'validation'
          ? 400
          : cause instanceof EventError && cause.code === 'illegal_transition'
            ? 409
            : cause instanceof OrganizationError && cause.code === 'forbidden'
              ? 403
              : 500;
      return message(form, event.locals.t(key), { status });
    }
  }
};
