import { z } from 'zod';
import type { Translator } from '$lib/i18n';
export function disclosureSchema(t: Translator) {
  const required = z
    .string({ error: t('legal.invalid') })
    .trim()
    .min(1, t('legal.invalid'));
  return z
    .object({
      sellerName: required.max(200),
      address: z.string().trim().max(1000).default(''),
      phone: z.string().trim().max(100).default(''),
      discloseOnRequest: z.boolean().default(false),
      email: z.email({ error: t('legal.invalid') }).max(254),
      additionalFees: z.enum(['none', 'included']).default('none'),
      refundPolicy: required.max(3000)
    })
    .superRefine((value, ctx) => {
      if (!value.discloseOnRequest && (!value.address || !value.phone))
        ctx.addIssue({
          code: 'custom',
          path: [!value.address ? 'address' : 'phone'],
          message: t('legal.invalid')
        });
    });
}
export type Disclosure = z.infer<ReturnType<typeof disclosureSchema>>;
