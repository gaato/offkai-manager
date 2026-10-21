import { z } from 'zod';

// Released om1 strings are a wire contract; retain this decoder when adding versions.
export const actionSchemas = {
  web: z.tuple([]),
  join: z.tuple([z.uuid()]),
  pay: z.tuple([z.uuid()]),
  status: z.tuple([z.uuid()]),
  cancel: z.tuple([z.uuid()]),
  cancel_confirm: z.tuple([z.uuid()]),
  edit: z.tuple([z.uuid()]),
  join_submit: z.tuple([z.uuid()]),
  edit_submit: z.tuple([z.uuid()]),
  retry_join: z.tuple([z.uuid()]),
  retry_edit: z.tuple([z.uuid()]),
  soon: z.tuple([z.enum(['panel', 'status', 'remind', 'checkin'])])
};
export type CustomAction = {
  [K in keyof typeof actionSchemas]: { action: K; args: z.infer<(typeof actionSchemas)[K]> };
}[keyof typeof actionSchemas];
export type DecodeResult =
  { ok: true; value: CustomAction } | { ok: false; error: 'unknown_or_expired' };

export function decodeCustomId(value: string): DecodeResult {
  const invalid = { ok: false, error: 'unknown_or_expired' } as const;
  if (value.length > 100) return invalid;
  const [version, action, ...args] = value.split(':');
  if (version !== 'om1') return invalid;
  switch (action) {
    case 'web': {
      const parsed = actionSchemas.web.safeParse(args);
      return parsed.success ? { ok: true, value: { action, args: parsed.data } } : invalid;
    }
    case 'soon': {
      const parsed = actionSchemas.soon.safeParse(args);
      return parsed.success ? { ok: true, value: { action, args: parsed.data } } : invalid;
    }
    case 'pay':
    case 'join':
    case 'status':
    case 'cancel':
    case 'cancel_confirm':
    case 'edit':
    case 'join_submit':
    case 'edit_submit':
    case 'retry_join':
    case 'retry_edit': {
      const parsed = actionSchemas[action].safeParse(args);
      return parsed.success ? { ok: true, value: { action, args: parsed.data } } : invalid;
    }
    default:
      return invalid;
  }
}

export function encodeCustomId(value: CustomAction): string {
  const encoded = ['om1', value.action, ...value.args].join(':');
  if (!decodeCustomId(encoded).ok) throw new Error('Invalid custom_id');
  return encoded;
}
