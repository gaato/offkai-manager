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
