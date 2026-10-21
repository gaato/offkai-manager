import { describe, expect, it } from 'vitest';
import { matchReception, type DoorCard } from '$lib/server/domain/checkin/door';
import { disclosureSchema } from '$lib/shared/disclosure';
import { translator } from '$lib/i18n';
import {
  renderDoorCard,
  renderReceptionEventPicker,
  renderReminderPreview,
  renderReceptionStatus
} from '$lib/server/interactions/reception-renderers';
import { decodeCustomId } from '$lib/server/interactions/custom-id';
import { buildRosterCSV } from '$lib/server/exports/roster';

const id = '12345678-1234-4234-8234-123456789012';
const disclosure = {
  sellerName: '主催者',
  email: 'organizer@example.test',
  address: '',
  phone: '',
  discloseOnRequest: true,
  additionalFees: 'none',
  refundPolicy: 'Contact us for refunds.'
};
describe('reception search and disclosures', () => {
  it('ranks exact numeric matches before name substrings and preserves numeric ordering', () => {
    const rows = [
      { number: 3, displayName: '42 guests' },
      { number: 42, displayName: 'Someone' },
      { number: 11, displayName: 'Other' }
    ];
    expect(matchReception(rows, '042').map((r) => r.number)).toEqual([42]);
    expect(matchReception(rows, '42').map((r) => r.number)).toEqual([42, 3]);
    expect(matchReception(rows, 'OTHER')[0].number).toBe(11);
    expect(
      matchReception(
        Array.from({ length: 60 }, (_, i) => ({ number: 60 - i, displayName: 'Guest' })),
        ''
      )
    ).toHaveLength(25);
    expect(matchReception(rows, '%')).toEqual([]);
  });
  it.each(['en', 'ja'] as const)('validates organizer-provided information in %s', (locale) => {
    const schema = disclosureSchema(translator(locale));
    expect(schema.safeParse(disclosure).success).toBe(true);
    expect(schema.safeParse({ ...disclosure, discloseOnRequest: false }).success).toBe(false);
    expect(
      schema.safeParse({
        ...disclosure,
        discloseOnRequest: false,
        address: 'Tokyo',
        phone: '03-1234-5678'
      }).success
    ).toBe(true);
    for (const patch of [
      { sellerName: ' ' },
      { email: 'invalid' },
      { refundPolicy: '' },
      { additionalFees: 'extra' }
    ])
      expect(schema.safeParse({ ...disclosure, ...patch }).success).toBe(false);
  });
  it('exports localized, formula-safe roster cells in supplied reception order', () => {
    const csv = buildRosterCSV(
      [
        {
          id,
          number: 42,
          name: '=formula',
          paymentState: 'paid',
          methods: ['payments.default_method.cash.label'],
          checkedIn: true
        }
      ],
      'en'
    );
    expect(csv).toContain("042,'=formula,Paid,Cash at reception,Yes");
    expect(csv).not.toContain('payments.default_method');
  });
});
function textLength(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n, v) => n + textLength(v), 0);
  if (value && typeof value === 'object')
    return Object.entries(value).reduce(
      (n, [k, v]) =>
        n +
        (k === 'content' && typeof v === 'string'
          ? v.length
          : k === 'components'
            ? textLength(v)
            : 0),
      0
    );
  return 0;
}
describe('reception Components V2 limits', () => {
  it.each(['en', 'ja'] as const)('caps worst-case cards and disables mentions in %s', (locale) => {
    const card = {
      registration: {
        id,
        number: 999999,
        displayNameSnapshot: '@everyone *Guest*'.repeat(1000),
        status: 'confirmed'
      },
      event: { id, organizationId: id, title: 'Event'.repeat(1000), capacity: 180 },
      requests: [{ status: 'pending' }],
      unpaid: [{ amountMinor: 9223372036854775807n, currency: 'JPY' }],
      methods: ['cash', 'paypay'].map((m) => ({ label: `payments.default_method.${m}.label` })),
      checkin: null,
      answers: Array.from({ length: 10 }, () => ({
        label: 'Question'.repeat(500),
        value: 'answer'.repeat(1000)
      }))
    } as unknown as DoorCard;
    const headingCard = renderDoorCard(
      { ...card, registration: { ...card.registration, number: 1 } },
      locale
    );
    const container = headingCard.data.components?.[0];
    expect(container?.type).toBe(17);
    expect(container?.type === 17 ? container.components[0].type : undefined).toBe(10);
    if (container?.type === 17 && container.components[0].type === 10)
      expect(container.components[0].content).toMatch(/^# 001\n\n@everyone/);
    const variants = [
      renderDoorCard(card, locale),
      renderDoorCard({ ...card, checkin: { at: new Date(), by: 'Staff'.repeat(1000) } }, locale),
      renderDoorCard({ ...card, registration: { ...card.registration, status: 'held' } }, locale),
      renderReceptionStatus(
        {
          event: card.event,
          confirmed: 180,
          held: 0,
          waitlisted: 40,
          unpaid: 180,
          totals: [['JPY', 990000n]],
          checkedIn: 180,
          unreachable: 5
        },
        locale,
        'https://example.test'
      ),
      renderReminderPreview(
        { id, event: card.event, recipients: [], held: 180, confirmed: 0, ja: 90, en: 90 },
        locale
      )
    ];
    for (const response of variants) {
      expect(response.data.flags).toBe(64 | 32768);
      expect(response.data.allowed_mentions).toEqual({ parse: [] });
      expect(textLength(response.data.components)).toBeLessThanOrEqual(4000);
      const wire = JSON.stringify(response);
      expect(wire).not.toContain('⟦');
      const buttons = Array.from(wire.matchAll(/"label":"([^"]*)"/g));
      for (const [, label] of buttons) expect(label.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('organizer event selector limits', () => {
  it.each(['en', 'ja'] as const)(
    'paginates every event with bounded labels and codec actions in %s',
    (locale) => {
      const events = Array.from({ length: 51 }, (_, i) => ({
        id: `12345678-1234-4234-8234-${String(i).padStart(12, '0')}`,
        title: `${i} @everyone ` + 'Event'.repeat(100)
      }));
      for (const page of [0, 1, 2, 99999]) {
        const current = Math.min(page, 2);
        const response = renderReceptionEventPicker(events, 'remind', locale, page);
        expect(response.type).toBe(4);
        expect(response.data.flags).toBe(64 | 32768);
        expect(response.data.allowed_mentions).toEqual({ parse: [] });
        expect(textLength(response.data.components)).toBeLessThanOrEqual(4000);
        const rows = (response.data.components ?? []).filter((component) => component.type === 1);
        const children = rows.flatMap((row) => [...row.components]);
        const select = children.find((component) => component.type === 3)!;
        expect(select.options.map((option) => option.value)).toEqual(
          events.slice(current * 25, (current + 1) * 25).map((event) => event.id)
        );
        expect(select.min_values).toBe(1);
        expect(select.max_values).toBe(1);
        expect(select.options.every((option) => option.label.length <= 100)).toBe(true);
        expect(decodeCustomId(select.custom_id)).toEqual({
          ok: true,
          value: { action: 'reception_pick', args: ['remind'] }
        });
        const buttons = children.filter((component) => component.type === 2);
        expect(buttons).toHaveLength(current === 1 ? 2 : 1);
        for (const button of buttons) {
          expect('custom_id' in button && decodeCustomId(button.custom_id).ok).toBe(true);
          expect('label' in button ? button.label?.length : undefined).toBeLessThanOrEqual(80);
        }
      }
      const empty = renderReceptionEventPicker([], 'status', locale);
      expect(empty.data.components).toHaveLength(1);
    }
  );
});
