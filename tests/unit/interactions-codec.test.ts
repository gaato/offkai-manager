import { describe, expect, it } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  decodeCustomId,
  encodeCustomId,
  type CustomAction
} from '$lib/server/interactions/custom-id';

const arbitraries = {
  door_check: fc.uuid().map((id): CustomAction => ({ action: 'door_check', args: [id] })),
  door_undo: fc.uuid().map((id): CustomAction => ({ action: 'door_undo', args: [id] })),
  door_cash: fc.uuid().map((id): CustomAction => ({ action: 'door_cash', args: [id] })),
  door_paypay: fc.uuid().map((id): CustomAction => ({ action: 'door_paypay', args: [id] })),
  remind_confirm: fc.uuid().map((id): CustomAction => ({ action: 'remind_confirm', args: [id] })),

  pay: fc.uuid().map((id): CustomAction => ({ action: 'pay', args: [id] })),
  join: fc.uuid().map((id): CustomAction => ({ action: 'join', args: [id] })),
  status: fc.uuid().map((id): CustomAction => ({ action: 'status', args: [id] })),
  cancel: fc.uuid().map((id): CustomAction => ({ action: 'cancel', args: [id] })),
  cancel_confirm: fc.uuid().map((id): CustomAction => ({ action: 'cancel_confirm', args: [id] })),
  edit: fc.uuid().map((id): CustomAction => ({ action: 'edit', args: [id] })),
  join_submit: fc.uuid().map((id): CustomAction => ({ action: 'join_submit', args: [id] })),
  edit_submit: fc.uuid().map((id): CustomAction => ({ action: 'edit_submit', args: [id] })),
  retry_join: fc.uuid().map((id): CustomAction => ({ action: 'retry_join', args: [id] })),
  retry_edit: fc.uuid().map((id): CustomAction => ({ action: 'retry_edit', args: [id] })),
  web: fc.constant<CustomAction>({ action: 'web', args: [] }),
  soon: fc.constantFrom('panel', 'status', 'remind', 'checkin').map(
    (feature) =>
      ({
        action: 'soon' as const,
        args: [feature]
      }) as CustomAction
  )
} satisfies Record<CustomAction['action'], fc.Arbitrary<CustomAction>>;
describe('om1 wire contract', () => {
  for (const [action, arbitrary] of Object.entries(arbitraries)) {
    test.prop([arbitrary])(`${action} round trips within 100 characters`, (value) => {
      const encoded = encodeCustomId(value);
      expect(encoded.length).toBeLessThanOrEqual(100);
      expect(decodeCustomId(encoded)).toEqual({ ok: true, value });
    });
  }
  it.each([
    ['om1:web', { action: 'web', args: [] }],
    ['om1:soon:panel', { action: 'soon', args: ['panel'] }],
    ['om1:soon:status', { action: 'soon', args: ['status'] }],
    ['om1:soon:remind', { action: 'soon', args: ['remind'] }],
    ['om1:soon:checkin', { action: 'soon', args: ['checkin'] }]
  ])('keeps released string %s decodable', (encoded, value) => {
    expect(decodeCustomId(encoded)).toEqual({ ok: true, value });
  });
  it.each([
    '',
    'om2:web',
    'om1:missing',
    'om1:web:extra',
    'om1:soon',
    'om1:soon:missing',
    'om1:soon:panel:extra',
    'om1:' + 'x'.repeat(100)
  ])('rejects %s', (value) => {
    expect(decodeCustomId(value)).toEqual({ ok: false, error: 'unknown_or_expired' });
  });
  test.prop([fc.string()])('arbitrary strings never throw', (value) => {
    expect(() => decodeCustomId(value)).not.toThrow();
  });
});
