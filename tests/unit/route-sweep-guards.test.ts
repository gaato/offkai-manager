import { expect, it } from 'vitest';
import { en, ja } from '$lib/i18n';
import { findRawEnums, opsRawEnums } from '../../e2e/render-guards';

it('accepts exact translated prose about active questions and staff/paid roles', () => {
  expect(
    findRawEnums(`${en['event.copy_help']}\n${en['discord_setup.layout_help']}`, 'en')
  ).toEqual([]);
  expect(
    findRawEnums(`${ja['event.copy_help']}\n${ja['discord_setup.layout_help']}`, 'ja')
  ).toEqual([]);
});
it.each(['en', 'ja'] as const)(
  'still detects bare values and values mixed into surrounding text in %s',
  (locale) => {
    const copy = locale === 'en' ? en : ja;
    const body = `${copy['discord_setup.layout_help']}\nactive\nstaff\npaid\nState: auto_confirm\nState: payment_pending`;
    expect(findRawEnums(body, locale)).toEqual([
      'active',
      'staff',
      'paid',
      'auto_confirm',
      'payment_pending'
    ]);
    expect(findRawEnums(body, locale, opsRawEnums)).toEqual([
      'staff',
      'auto_confirm',
      'payment_pending'
    ]);
  }
);
it('does not exempt interpolated values or unknown text merely because it resembles a translation', () => {
  expect(findRawEnums('Missing permissions for staff: pending.', 'en')).toEqual([
    'staff',
    'pending'
  ]);
  expect(findRawEnums(en['event.copy_help'].replace('active', 'disabled'), 'en')).toEqual([
    'disabled'
  ]);
  expect(findRawEnums('active\nactive', 'en')).toEqual(['active', 'active']);
});
