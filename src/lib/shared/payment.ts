import { z } from 'zod';

export const collectionStatuses = ['draft', 'open', 'closed', 'archived'] as const;
export const collectionStatusSchema = z.enum(collectionStatuses);
export type CollectionStatus = z.infer<typeof collectionStatusSchema>;

export const paymentTimings = ['advance', 'onsite', 'none'] as const;
export const paymentTimingSchema = z.enum(paymentTimings);
export type PaymentTiming = z.infer<typeof paymentTimingSchema>;

export const paymentConfirmations = ['internal', 'manual', 'none'] as const;
export const paymentConfirmationSchema = z.enum(paymentConfirmations);
export type PaymentConfirmation = z.infer<typeof paymentConfirmationSchema>;

export const paymentRequestStatuses = [
  'pending',
  'payment_pending',
  'paid',
  'waived',
  'cancelled'
] as const;
export const paymentRequestStatusSchema = z.enum(paymentRequestStatuses);
export type PaymentRequestStatus = z.infer<typeof paymentRequestStatusSchema>;

export function collectionStatusLabelKey(
  status: CollectionStatus
): `payments.collection_status.${CollectionStatus}` {
  return `payments.collection_status.${status}`;
}

export function paymentTimingLabelKey(timing: PaymentTiming): `payments.timing.${PaymentTiming}` {
  return `payments.timing.${timing}`;
}

export function paymentConfirmationLabelKey(
  confirmation: PaymentConfirmation
): `payments.confirmation.${PaymentConfirmation}` {
  return `payments.confirmation.${confirmation}`;
}

export function paymentRequestStatusLabelKey(
  status: PaymentRequestStatus
): `payments.request_status.${PaymentRequestStatus}` {
  return `payments.request_status.${status}`;
}

const systemMethodMessageKeys = [
  'payments.default_method.card.label',
  'payments.default_method.card.instructions',
  'payments.default_method.cash.label',
  'payments.default_method.cash.instructions',
  'payments.default_method.paypay.label',
  'payments.default_method.paypay.instructions',
  'payments.default_method.wise.label',
  'payments.default_method.wise.instructions',
  'payments.default_method.paypal.label',
  'payments.default_method.paypal.instructions',
  'payments.default_method.bank.label',
  'payments.default_method.bank.instructions',
  'payments.default_method.waiver.label',
  'payments.default_method.waiver.instructions'
] as const;
export type SystemPaymentMethodMessageKey = (typeof systemMethodMessageKeys)[number];

export function systemPaymentMethodMessageKey(value: string): SystemPaymentMethodMessageKey | null {
  return systemMethodMessageKeys.find((key) => key === value) ?? null;
}

export const stripeOnboardingStatuses = [
  'not_connected',
  'onboarding_required',
  'pending_verification',
  'ready',
  'disabled'
] as const;
export const stripeOnboardingStatusSchema = z.enum(stripeOnboardingStatuses);
export type StripeOnboardingStatus = z.infer<typeof stripeOnboardingStatusSchema>;

export function stripeOnboardingStatusLabelKey(
  status: StripeOnboardingStatus
): `stripe.status.${StripeOnboardingStatus}` {
  return `stripe.status.${status}`;
}
