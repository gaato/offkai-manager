import { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } from '@discordjs/builders';
import { escapeMarkdown, time } from '@discordjs/formatters';
import { translator, type Locale } from '$lib/i18n';
import { formatMoney } from '$lib/shared/money';
import { doorPaymentState, type DoorCard } from '../domain/checkin/door';
import type { receptionStatus, previewReminder } from '../domain/notifications/reception';
import { discordLimits } from '$lib/shared/discord-limits';
import { encodeCustomId } from './custom-id';
import { ephemeralReply } from './respond';
import { actionButton, ephemeralCard, excerpt } from './renderers';
const safe = (v: string, n: number) => excerpt(escapeMarkdown(v), n);
export function renderDoorCard(card: DoorCard, locale: Locale) {
  const t = translator(locale);
  const state = doorPaymentState(card);
  const amount = card.unpaid[0]
    ? formatMoney(card.unpaid[0].amountMinor, card.unpaid[0].currency, locale)
    : '';
  const buttons = [
    ...(card.checkin
      ? [actionButton({ action: 'door_undo', args: [card.registration.id] }, t('door.undo'), 4)]
      : card.registration.status === 'confirmed'
        ? [actionButton({ action: 'door_check', args: [card.registration.id] }, t('door.check'), 1)]
        : []),
    ...(['cash', 'paypay'] as const)
      .filter((m) =>
        card.methods.some((method) => method.label === `payments.default_method.${m}.label`)
      )
      .map((m) =>
        actionButton(
          { action: m === 'cash' ? 'door_cash' : 'door_paypay', args: [card.registration.id] },
          t(`door.${m}`, { amount }),
          1
        )
      )
  ];
  return ephemeralCard(
    [
      `# ${String(card.registration.number).padStart(3, '0')}`,
      safe(card.registration.displayNameSnapshot, 250),
      `${state === 'unpaid' ? '⚠️' : '✅'} ${t(`checkin.payment.${state}`)} ${amount}`,
      card.checkin
        ? t('door.checked', {
            name: safe(card.checkin.by ?? t('organization.role.staff'), 150),
            time: time(card.checkin.at, 'f')
          })
        : t('door.not_checked'),
      ...(card.registration.status === 'held' ? [t('door.held')] : []),
      ...card.answers
        .slice(0, 5)
        .map(
          (a) =>
            `${safe(a.label, 100)}: ${a.value === 'true' ? t('registration.answer_yes') : a.value === 'false' ? t('registration.answer_no') : safe(a.value, 300)}`
        )
    ].join('\n\n'),
    buttons
  );
}
export function renderReceptionStatus(
  status: Omit<ReturnType<typeof receptionStatus>, 'pricePending'> & { pricePending?: boolean },
  locale: Locale,
  baseUrl: string
) {
  const t = translator(locale);
  return ephemeralCard(
    `# ${safe(status.event.title, 250)}\n${t('door.status', { confirmed: status.confirmed, capacity: status.event.capacity ?? t('event.capacity_unlimited'), held: status.held, waitlisted: status.waitlisted, unpaid: status.unpaid, total: status.totals.map(([currency, n]) => formatMoney(n, currency, locale)).join(', ') || formatMoney(0n, 'JPY', locale), checked: status.checkedIn, unreachable: status.unreachable })}${status.pricePending ? `\n\n⚠️ ${t('door.price_pending')}` : ''}`,
    [
      new ButtonBuilder()
        .setStyle(5)
        .setLabel(t('door.dashboard'))
        .setURL(new URL(`/app/events/${status.event.id}`, baseUrl).href),
      new ButtonBuilder()
        .setStyle(5)
        .setLabel(t('legal.title'))
        .setURL(new URL(`/legal/${status.event.organizationId}`, baseUrl).href)
    ]
  );
}
export function renderReminderPreview(preview: ReturnType<typeof previewReminder>, locale: Locale) {
  const t = translator(locale);
  return ephemeralCard(
    `# ${safe(preview.event.title, 250)}\n${t('door.remind_preview', { held: preview.held, confirmed: preview.confirmed, ja: preview.ja, en: preview.en })}\n\n🇯🇵 ${translator('ja')('notify.payment_reminder')}\n\n🇬🇧 ${translator('en')('notify.payment_reminder')}`,
    [actionButton({ action: 'remind_confirm', args: [preview.id] }, t('door.remind_confirm'), 1)]
  );
}

export function renderReceptionEventPicker(
  events: readonly { id: string; title: string }[],
  command: 'status' | 'remind',
  locale: Locale,
  page = 0
) {
  const t = translator(locale);
  if (!events.length) return ephemeralReply(t('door.forbidden'));
  const pages = Math.ceil(events.length / discordLimits.selectOptions);
  const current = Math.max(0, Math.min(page, pages - 1));
  const response = ephemeralReply(
    t('door.pick_event') +
      (pages > 1 ? `\n${t('door.event_page', { page: current + 1, pages })}` : '')
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId({ action: 'reception_pick', args: [command] }))
    .setPlaceholder(t('door.pick_event'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      events
        .slice(current * discordLimits.selectOptions, (current + 1) * discordLimits.selectOptions)
        .map((event) => ({ label: excerpt(event.title, 100), value: event.id }))
    );
  const navigation = [
    ...(current > 0
      ? [
          actionButton(
            { action: 'reception_page', args: [command, String(current - 1)] },
            t('door.previous')
          )
        ]
      : []),
    ...(current + 1 < pages
      ? [
          actionButton(
            { action: 'reception_page', args: [command, String(current + 1)] },
            t('door.next')
          )
        ]
      : [])
  ];
  return {
    ...response,
    data: {
      ...response.data,
      components: [
        ...(response.data.components ?? []),
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select).toJSON(),
        ...(navigation.length
          ? [new ActionRowBuilder<ButtonBuilder>().addComponents(navigation).toJSON()]
          : [])
      ]
    }
  };
}
