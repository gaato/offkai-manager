import { translator, type Locale } from '$lib/i18n';
import type { getRoster } from '../domain/checkin/roster';
import { systemPaymentMethodMessageKey } from '$lib/shared/payment';
import { encodeCSV } from '$lib/shared/csv';
export function buildRosterCSV(rows: ReturnType<typeof getRoster>, locale: Locale) {
  const t = translator(locale);
  return (
    '\uFEFF' +
    encodeCSV([
      [
        t('roster.number'),
        t('roster.name'),
        t('roster.payment'),
        t('roster.method'),
        t('roster.checked')
      ],
      ...rows.map((r) => [
        String(r.number).padStart(3, '0'),
        r.name,
        t(`checkin.payment.${r.paymentState}`),
        r.methods
          .map((m) => {
            const key = systemPaymentMethodMessageKey(m);
            return key ? t(key) : m;
          })
          .join('; '),
        t(r.checkedIn ? 'registration.answer_yes' : 'registration.answer_no')
      ])
    ])
  );
}
