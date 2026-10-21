import { systemPaymentMethodMessageKey } from '$lib/shared/payment';
import { formatMoney } from '$lib/shared/money';
import type { paymentRequests } from '$lib/server/db/schema';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  TextDisplayBuilder
} from '@discordjs/builders';
import { escapeMarkdown, time } from '@discordjs/formatters';
import type {
  APIInteractionResponseChannelMessageWithSource,
  RESTPostAPIChannelMessageJSONBody
} from 'discord-api-types/v10';
import { formatWallClock } from '$lib/server/time';
import { renderPanelTemplate, truncatePanelBody } from './panel-template';
import { discordLimits } from '$lib/shared/discord-limits';
import { translator, type Locale, type MessageKey } from '$lib/i18n';
import type { events } from '$lib/server/db/schema';
import type { OwnedRegistrationDetail } from '$lib/server/domain/registrations/participant';
import { encodeCustomId, type CustomAction } from './custom-id';

// Reserve space for button labels and translated status text within the total message budget.
const messageTextBudget = discordLimits.messageText - 350;
type PanelEvent = typeof events.$inferSelect & { priceMinor?: bigint };
export const excerpt = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max - 1) + '…' : value;
const safe = (value: string, max: number) => excerpt(escapeMarkdown(value), max);
export function actionButton(action: CustomAction, label: string, style: 1 | 2 | 4 = 2) {
  return new ButtonBuilder().setCustomId(encodeCustomId(action)).setLabel(label).setStyle(style);
}
function card(text: string, buttons: ButtonBuilder[] = []): RESTPostAPIChannelMessageJSONBody {
  return {
    flags: 32768,
    allowed_mentions: { parse: [] },
    components: [
      new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
        .addActionRowComponents(
          ...(buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [])
        )
        .toJSON()
    ]
  };
}
export function ephemeralCard(
  text: string,
  buttons: ButtonBuilder[] = []
): APIInteractionResponseChannelMessageWithSource {
  const data = card(excerpt(text, messageTextBudget), buttons);
  return { type: 4, data: { ...data, flags: 64 | 32768 } };
}

/** now is data supplied by the shell; rendering never reads the wall clock. */
export function renderPanel(
  event: PanelEvent,
  counts: { confirmed: number; now: Date; timeZone?: string },
  locale: Locale
): RESTPostAPIChannelMessageJSONBody {
  const t = translator(locale);
  const open =
    !event.cancelledAt &&
    !event.archivedAt &&
    event.visibility !== 'draft' &&
    counts.now >= event.registrationOpensAt &&
    counts.now <= event.registrationClosesAt;
  const full = event.capacity !== null && counts.confirmed >= event.capacity;
  const state = !open
    ? 'panel.closed'
    : full && event.registrationMode === 'auto_confirm'
      ? 'panel.full'
      : 'panel.open';
  const venue =
    event.venueReveal === 'confirmed'
      ? t('panel.venue_hidden')
      : [safe(event.venueName, 300), safe(event.venueAddress, 500)].filter(Boolean).join('\n') ||
        t('panel.venue_empty');
  const header = [
    `# ${safe(event.title, 300)}`,
    t('panel.start', { absolute: time(event.startsAt, 'F'), relative: time(event.startsAt, 'R') }),
    t('panel.end', { absolute: time(event.endsAt, 'F'), relative: time(event.endsAt, 'R') }),
    venue,
    event.capacity === null
      ? t('panel.count', { count: counts.confirmed })
      : t('panel.capacity', { count: counts.confirmed, capacity: event.capacity }),
    ...(event.priceMinor && event.priceMinor > 0n
      ? [formatMoney(event.priceMinor, 'JPY', locale)]
      : []),
    t(state)
  ]
    .filter(Boolean)
    .join('\n\n');
  const zone = counts.timeZone ?? 'Asia/Tokyo';
  const template =
    (locale === 'ja' ? event.panelTemplateJa : event.panelTemplateEn) ||
    t('panel_template.default');
  const body = renderPanelTemplate(template, {
    title: event.title,
    date: formatWallClock(event.startsAt, locale, zone, { dateStyle: 'long' }),
    start: formatWallClock(event.startsAt, locale, zone, { timeStyle: 'short' }),
    end: formatWallClock(event.endsAt, locale, zone, { timeStyle: 'short' }),
    venue:
      event.venueReveal === 'confirmed'
        ? t('panel.venue_hidden')
        : [event.venueName, event.venueAddress].filter(Boolean).join(' · ') ||
          t('panel.venue_empty'),
    fee:
      event.priceMinor && event.priceMinor > 0n ? formatMoney(event.priceMinor, 'JPY', locale) : '',
    capacity: event.capacity === null ? t('event.capacity_unlimited') : String(event.capacity),
    deadline: formatWallClock(event.registrationClosesAt, locale, zone)
  });
  // Keep state and controls intact; only the organizer-authored body is shortened.
  const text =
    header +
    '\n\n' +
    truncatePanelBody(body, messageTextBudget - header.length - 2, t('panel_template.truncated'));
  return card(text, [
    actionButton({ action: 'join', args: [event.id] }, t('panel.join'), 1),
    actionButton({ action: 'status', args: [event.id] }, t('panel.status')),
    actionButton({ action: 'cancel', args: [event.id] }, t('panel.cancel'), 4)
  ]);
}

export function renderStatus(
  detail: OwnedRegistrationDetail | null,
  eventId: string,
  locale: Locale,
  payment?: {
    request: typeof paymentRequests.$inferSelect;
    checkoutUrl?: string;
    manualMethods: string[];
  }
): APIInteractionResponseChannelMessageWithSource {
  const t = translator(locale);
  if (!detail)
    return ephemeralCard(t('participant.none'), [
      actionButton({ action: 'join', args: [eventId] }, t('panel.join'), 1)
    ]);
  const { registration, answers, event } = detail;
  const statusKey: MessageKey = `participant.${registration.status}`;
  const summary = answers
    .map(
      (answer) =>
        `**${safe(answer.label, 120)}**\n${safe(
          answer.type === 'checkbox' || answer.type === 'consent'
            ? t(answer.valueBool ? 'participant.yes' : 'participant.no')
            : answer.type === 'text' || answer.type === 'textarea'
              ? answer.valueText
              : answer.optionLabels.join(', '),
          300
        )}`
    )
    .join('\n\n');
  const venue =
    registration.status === 'confirmed' && event.venueReveal === 'confirmed'
      ? [safe(event.venueName, 300), safe(event.venueAddress, 500)].filter(Boolean).join('\n')
      : '';
  return ephemeralCard(
    [
      `## ${safe(event.title, 250)}`,
      t('participant.reception'),
      `# ${String(registration.number).padStart(3, '0')}`,
      t(statusKey),
      venue,
      ...(payment
        ? [
            formatMoney(payment.request.amountMinor, payment.request.currency, locale),
            t(
              payment.request.status === 'paid'
                ? 'payment.paid'
                : payment.request.status === 'waived'
                  ? 'payment.waived'
                  : payment.request.status === 'refund_due'
                    ? 'payment.refund_due'
                    : payment.request.status === 'payment_pending'
                      ? 'payment.checkout_open'
                      : 'payment.unpaid'
            ),
            ...(registration.holdExpiresAt && registration.status === 'held'
              ? [t('payment.hold_countdown', { time: time(registration.holdExpiresAt, 'R') })]
              : []),
            ...(event.paymentRequirement === 'pay_later' && payment.manualMethods.length
              ? [
                  t('payment.manual_note', {
                    methods: payment.manualMethods
                      .map((value) => {
                        const key = systemPaymentMethodMessageKey(value);
                        return key ? t(key) : safe(value, 100);
                      })
                      .join(' / ')
                  })
                ]
              : [])
          ]
        : []),
      excerpt(summary, 2_000)
    ]
      .filter(Boolean)
      .join('\n\n'),
    [
      ...(payment?.checkoutUrl && ['pending', 'payment_pending'].includes(payment.request.status)
        ? [new ButtonBuilder().setStyle(5).setLabel(t('payment.pay')).setURL(payment.checkoutUrl)]
        : payment &&
            ['pending', 'payment_pending'].includes(payment.request.status) &&
            registration.status !== 'cancelled'
          ? [actionButton({ action: 'pay', args: [eventId] }, t('payment.pay'), 1)]
          : registration.holdReleased
            ? [actionButton({ action: 'pay', args: [eventId] }, t('payment.pay'), 1)]
            : []),
      ...(registration.status !== 'cancelled'
        ? [
            actionButton({ action: 'edit', args: [eventId] }, t('participant.edit')),
            actionButton({ action: 'cancel', args: [eventId] }, t('panel.cancel'), 4)
          ]
        : [actionButton({ action: 'join', args: [eventId] }, t('panel.join'), 1)]),
      actionButton({ action: 'status', args: [eventId] }, t('participant.refresh'))
    ]
  );
}
export function renderCancelConfirm(event: PanelEvent, locale: Locale) {
  const t = translator(locale);
  return ephemeralCard(
    [
      t('participant.cancel_prompt'),
      `## ${safe(event.title, 300)}`,
      safe(event.cancellationPolicy, 2_800)
    ]
      .filter(Boolean)
      .join('\n\n'),
    [
      actionButton(
        { action: 'cancel_confirm', args: [event.id] },
        t('participant.confirm_cancel'),
        4
      ),
      actionButton({ action: 'status', args: [event.id] }, t('panel.status'))
    ]
  );
}
