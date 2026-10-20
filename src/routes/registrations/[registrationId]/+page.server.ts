import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  getParticipantPaymentDetail,
  PaymentError,
  startCheckout
} from '$lib/server/domain/payments';
import {
  canWithdrawRegistration,
  getOwnedRegistration,
  publicVenue,
  RegistrationError,
  type RegistrationAnswerView
} from '$lib/server/domain/registrations';
import { formatWallClock } from '$lib/server/time';
import { formatMoney } from '$lib/shared/money';
import { paymentRequestStatusLabelKey, systemPaymentMethodMessageKey } from '$lib/shared/payment';
import { registrationStatusLabelKey } from '$lib/shared/registration';

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'Cache-Control': 'private, no-store' });
  if (!event.locals.session) throw error(404);
  const registrationId = z.uuid().safeParse(event.params.registrationId);
  if (!registrationId.success) throw error(404);

  let detail;
  try {
    detail = await getOwnedRegistration(
      getDatabaseClient(getConfig()),
      registrationId.data,
      event.locals.session.userId
    );
  } catch (cause) {
    if (cause instanceof RegistrationError && cause.code === 'not_found') throw error(404);
    event.locals.logger.error({ err: cause }, 'load participant registration failed');
    throw error(500);
  }

  const config = getConfig();
  const payment = await getParticipantPaymentDetail(
    getDatabaseClient(config),
    registrationId.data,
    event.locals.session.userId
  );
  const venue = publicVenue(detail.event, detail.registration.status === 'confirmed');
  const venueLine = [venue.name, venue.address].filter(Boolean).join(' / ');
  return {
    eventTitle: detail.event.title,
    organizationName: detail.organizationName,
    schedule: event.locals.t('event.schedule', {
      start: formatWallClock(detail.event.startsAt, event.locals.locale, config.time.zone),
      end: formatWallClock(detail.event.endsAt, event.locals.locale, config.time.zone)
    }),
    venueLine,
    venueHidden: venue.revealAfterConfirmation,
    contact: detail.event.contact,
    eventCancelled: detail.event.cancelledAt !== null,
    statusLabel: event.locals.t(registrationStatusLabelKey(detail.registration.status)),
    next: event.locals.t(`registration.next.${detail.registration.status}`),
    answers: detail.answers.map((answer) => ({
      label: answer.label,
      value: answerValue(event.locals, answer)
    })),
    payment: payment
      ? {
          title: payment.collectionTitle,
          amount: formatMoney(payment.amountMinor, payment.currency, event.locals.locale),
          dueAt: payment.dueAt
            ? formatWallClock(payment.dueAt, event.locals.locale, config.time.zone)
            : event.locals.t('payments.due_not_set'),
          method: localizedPaymentText(event.locals, payment.methodLabel),
          methodInstructions: localizedPaymentText(event.locals, payment.methodInstructions),
          collectionInstructions: payment.collectionInstructions,
          online: payment.methodConfirmation === 'internal',
          canCheckout: payment.canCheckout,
          onlineUnavailable:
            payment.methodConfirmation === 'internal' &&
            ['pending', 'pending_external_creation', 'payment_pending'].includes(payment.status) &&
            !payment.canCheckout,
          statusLabel: event.locals.t(paymentRequestStatusLabelKey(payment.status)),
          paid: payment.status === 'paid',
          paidAt: payment.paidAt
            ? formatWallClock(payment.paidAt, event.locals.locale, config.time.zone, {
                dateStyle: 'medium',
                timeStyle: 'short'
              })
            : null
        }
      : null,
    paymentPlaceholder: event.locals.t('registration.payment_placeholder'),
    paymentFlash:
      event.url.searchParams.get('payment') === 'success'
        ? event.locals.t('registration.payment_return_success')
        : event.url.searchParams.get('payment') === 'cancelled'
          ? event.locals.t('registration.payment_return_cancelled')
          : null,
    withdrawn: event.url.searchParams.get('withdrawn') === '1',
    canWithdraw: canWithdrawRegistration(detail),
    withdrawHref: `/registrations/${registrationId.data}/withdraw`
  };
};

export const actions: Actions = {
  checkout: async (event) => {
    if (!event.locals.session) throw error(404);
    const registrationId = z.uuid().safeParse(event.params.registrationId);
    if (!registrationId.success) throw error(404);
    const config = getConfig();
    const gateway = getApp(config).stripe.payment;
    if (!gateway) {
      return fail(503, { checkoutError: event.locals.t('registration.payment_error_unavailable') });
    }
    let checkoutUrl: string;
    try {
      checkoutUrl = await startCheckout(getDatabaseClient(config), gateway, {
        userId: event.locals.session.userId,
        registrationId: registrationId.data,
        successUrl: new URL(
          `/registrations/${registrationId.data}?payment=success`,
          config.auth.publicBaseUrl
        ).toString(),
        cancelUrl: new URL(
          `/registrations/${registrationId.data}?payment=cancelled`,
          config.auth.publicBaseUrl
        ).toString()
      });
    } catch (cause) {
      event.locals.logger[cause instanceof PaymentError ? 'warn' : 'error'](
        { err: cause },
        'start participant checkout failed'
      );
      if (cause instanceof PaymentError && cause.code === 'not_found') throw error(404);
      const status = cause instanceof PaymentError && cause.code === 'gateway' ? 502 : 409;
      return fail(status, {
        checkoutError:
          cause instanceof PaymentError && cause.code === 'not_ready'
            ? event.locals.t('registration.payment_error_unavailable')
            : event.locals.t('registration.payment_error_conflict')
      });
    }
    throw redirect(303, checkoutUrl);
  }
};

function localizedPaymentText(locals: App.Locals, value: string): string {
  const key = systemPaymentMethodMessageKey(value);
  return key ? locals.t(key) : value;
}

function answerValue(locals: App.Locals, answer: RegistrationAnswerView): string {
  if (answer.type === 'checkbox' || answer.type === 'consent') {
    return locals.t(answer.valueBool ? 'registration.answer_yes' : 'registration.answer_no');
  }
  if (answer.type === 'select' || answer.type === 'multiselect') {
    return (
      answer.optionLabels.join(locals.t('registration.answer_separator')) ||
      locals.t('registration.answer_empty')
    );
  }
  return answer.valueText || locals.t('registration.answer_empty');
}
