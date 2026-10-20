import type { Locale } from '$lib/i18n';

/** Formats integer minor units without converting through a lossy JavaScript number. */
export function formatMoney(amountMinor: bigint, currency: string, locale: Locale): string {
  const normalized = currency.trim().toUpperCase();
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: normalized,
    currencyDisplay: 'symbol',
    maximumFractionDigits: normalized === 'JPY' ? 0 : undefined
  }).format(amountMinor);
}
