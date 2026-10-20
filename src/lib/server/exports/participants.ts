import { translate, type Locale } from '$lib/i18n';
import type { ParticipantExport } from '$lib/server/domain/registrations';
import { formatExportWallClock } from '$lib/server/time';
import { encodeCSV } from '$lib/shared/csv';
import { registrationStatusLabelKey } from '$lib/shared/registration';

export function buildParticipantCSV(data: ParticipantExport, locale: Locale, zone: string): string {
  const rows = [
    [
      translate(locale, 'participants.display_name'),
      translate(locale, 'participants.username'),
      translate(locale, 'participants.status'),
      translate(locale, 'participants.registered_at'),
      ...data.fields.map(({ label }) => label)
    ],
    ...data.rows.map((row) => {
      const answers = new Map(row.answers.map((answer) => [answer.fieldId, answer]));
      return [
        row.displayName,
        row.username,
        translate(locale, registrationStatusLabelKey(row.status)),
        formatExportWallClock(row.registeredAt, zone),
        ...data.fields.map((field) => {
          const answer = answers.get(field.id);
          if (!answer) return '';
          if (field.type === 'select' || field.type === 'multiselect') {
            return answer.optionLabels.join('; ');
          }
          if (field.type === 'checkbox' || field.type === 'consent') {
            if (answer.valueBool === null) return '';
            return translate(
              locale,
              answer.valueBool ? 'registration.answer_yes' : 'registration.answer_no'
            );
          }
          return answer.valueText;
        })
      ];
    })
  ];
  return `\uFEFF${encodeCSV(rows)}`;
}
