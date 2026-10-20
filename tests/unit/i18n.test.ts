import { describe, expect, it } from 'vitest';
import { en, ja, resolveLocale, translate } from '$lib/i18n';

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

describe('internationalization catalog', () => {
  it('has no empty strings and matching placeholders', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key], `empty English message: ${key}`).not.toBe('');
      expect(ja[key], `empty Japanese message: ${key}`).not.toBe('');
      expect(placeholders(ja[key]), `placeholder mismatch: ${key}`).toEqual(placeholders(en[key]));
    }
  });
  it('resolves query, cookie, weighted header, and fallback in order', () => {
    expect(resolveLocale('ja-JP', 'en', 'en-US')).toBe('ja');
    expect(resolveLocale(null, 'ja', 'en-US')).toBe('ja');
    expect(resolveLocale(null, undefined, 'en;q=0.5, ja-JP;q=0.9')).toBe('ja');
    expect(resolveLocale(null, undefined, 'fr')).toBe('en');
  });
  it('substitutes placeholders', () => {
    expect(translate('en', 'session.signed_in_as', { name: 'Mika' })).toContain('Mika');
  });
});
