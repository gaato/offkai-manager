import { z } from 'zod';
import { paymentRequirements } from './payment';
export const eventPaymentFields = (message: string) => ({
  paymentRequirement: z.enum(paymentRequirements, { error: message }).default('none'),
  amountToCollect: z
    .string({ error: message })
    .regex(/^\d{1,8}$/, message)
    .default('0'),
  roundingUnit: z.coerce.number({ error: message }).int(message).positive(message).default(1),
  priceOverride: z
    .string({ error: message })
    .regex(/^\d{0,8}$/, message)
    .default(''),
  pricePending: z.boolean({ error: message }).default(false),
  paymentOpensAt: z.string({ error: message }).default(''),
  paymentDueAt: z.string({ error: message }).default(''),
  additionalOpensAt: z.string({ error: message }).default(''),
  manualCash: z.boolean({ error: message }).default(false),
  manualPayPay: z.boolean({ error: message }).default(false),
  holdMinutes: z.coerce
    .number({ error: message })
    .int(message)
    .positive(message)
    .max(1440, message)
    .default(30)
});
export type EventPaymentForm = z.infer<z.ZodObject<ReturnType<typeof eventPaymentFields>>>;

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function validatePaymentSchedule(
  data: Pick<
    EventPaymentForm,
    'paymentRequirement' | 'pricePending' | 'paymentOpensAt' | 'paymentDueAt' | 'additionalOpensAt'
  > & { startsAt: string },
  addIssue: (field: keyof EventPaymentForm | 'startsAt', message: string) => void,
  messages: {
    datetime: string;
    dueRequired: string;
    order: string;
    additional: string;
    pending: string;
  }
): void {
  const scheduled = data.paymentOpensAt !== '';
  for (const field of ['paymentOpensAt', 'paymentDueAt', 'additionalOpensAt'] as const) {
    if (data[field] && !datetimeLocal.test(data[field])) addIssue(field, messages.datetime);
  }
  if (!scheduled && data.paymentDueAt) addIssue('paymentOpensAt', messages.dueRequired);
  if (scheduled && !data.paymentDueAt) addIssue('paymentDueAt', messages.dueRequired);
  if (
    scheduled &&
    data.paymentDueAt &&
    (!(data.paymentOpensAt < data.paymentDueAt) || !(data.paymentDueAt < data.startsAt))
  )
    addIssue('paymentDueAt', messages.order);
  if (data.additionalOpensAt && (!scheduled || data.additionalOpensAt < data.paymentOpensAt))
    addIssue('additionalOpensAt', messages.additional);
  if (data.pricePending && (data.paymentRequirement !== 'pay_later' || !scheduled))
    addIssue('pricePending', messages.pending);
}
