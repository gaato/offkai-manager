import { en, ja, type Locale } from '../src/lib/i18n';

export const rawEnums =
  /\b(owner|staff|viewer|organizer|active|disabled|draft|public|unlisted|auto_confirm|approval|cancelled|archived|pending|payment_pending|paid|waived|advance|onsite|internal)\b/g;
export const opsRawEnums = /\b(owner|staff|viewer|auto_confirm|payment_pending|onsite|internal)\b/g;

/** Known translated prose can legitimately discuss roles/statuses; unmapped values still fail. */
export function findRawEnums(text: string, locale: Locale, pattern = rawEnums): string[] {
  const catalog = locale === 'ja' ? ja : en;
  const prose = Object.values(catalog)
    // Never exempt a bare enum/label, or interpolated values inside a translated message.
    .filter((message) => /\s/.test(message) && message.match(pattern))
    .sort((a, b) => b.length - a.length);
  const remaining = prose.reduce((body, message) => body.replaceAll(message, ' '), text);
  return remaining.match(pattern) ?? [];
}
