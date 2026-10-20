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

  it('uses the approved public vocabulary and states the All-In rule', () => {
    const catalogText = `${Object.values(en).join('\n')}\n${Object.values(ja).join('\n')}`;
    expect(catalogText).not.toMatch(/クラウドファンディング|クラファン/);
    expect(ja['campaign.kind']).toBe('応援企画');
    expect(ja['campaign.pledge.all_in_body']).toContain(
      '集まった金額がそのまま幹事に渡ります。目標未達でも返金はありません。'
    );
  });

  it('keeps internal enum tokens out of campaign console copy', () => {
    const campaignAdminCopy = Object.entries(en)
      .filter(([key]) => key.startsWith('campaign_admin.'))
      .map(([, value]) => value)
      .join('\n');
    expect(campaignAdminCopy).not.toMatch(
      /\b(owner|staff|viewer|organizer|active|disabled|draft|public|unlisted|auto_confirm|approval|confirmed|cancelled|archived|pending|pending_external_creation|payment_pending|paid|waived|advance|onsite|internal)\b/
    );
  });
});
