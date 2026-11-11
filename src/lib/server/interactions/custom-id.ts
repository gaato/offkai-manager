import { z } from 'zod';

// om1 strings on messages posted by a publicly released version are a wire contract: keep them
// decodable when adding versions, because those messages stay clickable after an upgrade.
// Strings only ever posted before the first public release (staging, test servers) may be retired.
export const actionSchemas = {
  web: z.tuple([]),
  reception_pick: z.tuple([z.enum(['status', 'remind'])]),
  reception_page: z.tuple([z.enum(['status', 'remind']), z.string().regex(/^(0|[1-9]\d{0,4})$/)]),
  door_check: z.tuple([z.uuid()]),
  door_undo: z.tuple([z.uuid()]),
  door_cash: z.tuple([z.uuid()]),
  door_paypay: z.tuple([z.uuid()]),
  remind_confirm: z.tuple([z.uuid()]),

  join: z.tuple([z.uuid()]),
  pay: z.tuple([z.uuid()]),
  status: z.tuple([z.uuid()]),
  cancel: z.tuple([z.uuid()]),
  cancel_confirm: z.tuple([z.uuid()]),
  edit: z.tuple([z.uuid()]),
  join_submit: z.tuple([z.uuid()]),
  edit_submit: z.tuple([z.uuid()]),
  retry_join: z.tuple([z.uuid()]),
  retry_edit: z.tuple([z.uuid()])
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
    case 'reception_pick': {
      const parsed = actionSchemas.reception_pick.safeParse(args);
      return parsed.success ? { ok: true, value: { action, args: parsed.data } } : invalid;
    }
    case 'reception_page': {
      const parsed = actionSchemas.reception_page.safeParse(args);
      return parsed.success ? { ok: true, value: { action, args: parsed.data } } : invalid;
    }
    case 'door_check':
    case 'door_undo':
    case 'door_cash':
    case 'door_paypay':
    case 'remind_confirm':
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
