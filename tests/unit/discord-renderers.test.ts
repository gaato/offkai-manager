import { describe, expect, it } from 'vitest';
import { renderPanel, renderStatus, renderCancelConfirm } from '$lib/server/interactions/renderers';
import { renderRegistrationModal, submittedAnswers } from '$lib/server/interactions/modal';
import type { EventSummary, RegistrationFormField } from '$lib/server/domain/events';
import type { OwnedRegistrationDetail } from '$lib/server/domain/registrations/participant';
import { translator } from '$lib/i18n';
import { unknownPanelVariables } from '$lib/shared/panel-template';
import { formFieldTypes } from '$lib/shared/registration-form';
import { makeModalSubmit } from '../support/interactions';

const event: EventSummary = {
  id: '12345678-1234-4234-8234-123456789012',
  organizationId: '12345678-1234-4234-8234-123456789013',
  paymentRequirement: 'none',
  platformFeeBps: 0,
  amountToCollectMinor: 0n,
  roundingUnit: 1,
  holdMinutes: 30,
  title: 'Meetup @everyone',
  slug: 'meetup',
  description: 'Welcome!',
  startsAt: new Date('2027-01-01T03:00:00Z'),
  endsAt: new Date('2027-01-01T06:00:00Z'),
  capacity: 20,
  registrationOpensAt: new Date('2026-01-01T00:00:00Z'),
  registrationClosesAt: new Date('2027-01-01T00:00:00Z'),
  visibility: 'public',
  discordPolicy: 'optional',
  venueName: 'Venue',
  venueAddress: 'Tokyo',
  venueReveal: 'public',
  contact: '',
  panelTemplateJa: '',
  panelTemplateEn: '',
  panelTemplateReviewedAt: null,
  cancellationPolicy: 'Contact staff.',
  registrationMode: 'auto_confirm',
  cancelledAt: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0)
};
const now = new Date('2026-10-21T00:00:00Z');
function field(type: RegistrationFormField['type']): RegistrationFormField {
  return {
    id: '12345678-1234-4234-8234-123456789014',
    eventId: event.id,
    key: 'question',
    label: 'Question',
    type,
    required: true,
    position: 10,
    helpText: 'Please answer',
    archivedAt: null,
    options: [
      { id: 'a', key: 'a', label: 'Option A', position: 10 },
      { id: 'b', key: 'b', label: 'Option B', position: 20 }
    ]
  };
}
function detail(
  status: OwnedRegistrationDetail['registration']['status'] = 'confirmed'
): OwnedRegistrationDetail {
  return {
    event,
    organizationName: 'Organizer',
    registration: {
      id: '12345678-1234-4234-8234-123456789015',
      eventId: event.id,
      userId: '12345678-1234-4234-8234-123456789016',
      number: 42,
      status,
      displayNameSnapshot: 'Participant',
      searchText: '',
      createdAt: now,
      updatedAt: now
    },
    answers: [
      { label: 'Allergies', type: 'text', valueText: 'None', valueBool: null, optionLabels: [] }
    ]
  };
}
function inspect(value: unknown): { components: number; text: number } {
  if (Array.isArray(value))
    return value
      .map(inspect)
      .reduce((a, b) => ({ components: a.components + b.components, text: a.text + b.text }), {
        components: 0,
        text: 0
      });
  if (!value || typeof value !== 'object') return { components: 0, text: 0 };
  const node = value as Record<string, unknown>;
  if (node.type === 1 && Array.isArray(node.components))
    expect(node.components.length).toBeLessThanOrEqual(5);
  if (typeof node.custom_id === 'string') expect(node.custom_id.length).toBeLessThanOrEqual(100);
  const children = Object.values(node)
    .filter((child) => child !== null && typeof child === 'object')
    .map(inspect);
  return children.reduce(
    (a, b) => ({ components: a.components + b.components, text: a.text + b.text }),
    {
      components: typeof node.type === 'number' ? 1 : 0,
      text: ['content', 'label', 'description', 'title'].reduce(
        (n, key) => n + (typeof node[key] === 'string' ? node[key].length : 0),
        0
      )
    }
  );
}
describe('Discord pure renderers', () => {
  it.each(['ja', 'en'] as const)(
    'snapshots panel, status states, and cancellation in %s',
    (locale) => {
      const panel = renderPanel(event, { confirmed: 4, now }, locale);
      expect(panel).toMatchSnapshot('panel');
      for (const status of ['applied', 'waitlisted', 'confirmed', 'cancelled'] as const)
        expect(renderStatus(detail(status), event.id, locale)).toMatchSnapshot(status);
      expect(renderStatus(null, event.id, locale)).toMatchSnapshot('none');
      expect(renderCancelConfirm(event, locale)).toMatchSnapshot('cancel');
    }
  );
  it.each(['ja', 'en'] as const)('renders pending fee and schedule variables in %s', (locale) => {
    const paymentOpensAt = new Date('2026-12-01T00:00:00Z');
    const paymentDueAt = new Date('2026-12-15T00:00:00Z');
    const additionalOpensAt = new Date('2026-12-16T00:00:00Z');
    const rendered = JSON.stringify(
      renderPanel(
        {
          ...event,
          paymentRequirement: 'pay_later',
          paymentOpensAt,
          paymentDueAt,
          additionalOpensAt
        },
        { confirmed: 4, now },
        locale
      )
    );
    expect(rendered).toContain(translator(locale)('payment.price_tba'));
    for (const date of [paymentOpensAt, paymentDueAt, additionalOpensAt])
      expect(rendered).toContain(`<t:${Math.floor(date.getTime() / 1000)}:F>`);
  });
  it.each(['ja', 'en'] as const)(
    'keeps the adapted default structured, neutral, and limited to supported variables in %s',
    (locale) => {
      const t = translator(locale);
      const template = t('panel_template.default');
      const headings =
        locale === 'ja'
          ? ['重要なルール', '参加方法', 'キャンセル', 'マナー・注意事項']
          : ['Important rules', 'How to join', 'Cancellation', 'Conduct and practical notes'];
      expect(template.match(/^### (.+)$/gm)).toEqual(headings.map((heading) => `### ${heading}`));
      expect(unknownPanelVariables(template)).toEqual([]);
      // The header already shows the fee, so the body only carries the payment schedule.
      expect(template).not.toContain('{fee}');
      expect(template).toContain('{payment_opens}');
      expect(template).toContain('{payment_due}');
      expect(template).toContain('{additional_opens}');
      expect(template).not.toMatch(/^## /m);
      for (const key of ['panel.join', 'panel.status', 'panel.cancel'] as const)
        expect(template).toContain(t(key));
      expect(template).toContain('20');
      expect(template).toMatch(
        locale === 'ja' ? /参加確定後の返金はできません/ : /non-refundable after confirmation/
      );
      expect(template).not.toMatch(
        /Peatix|hololive|Expo|7th|ちばちゃん|海浜幕張|Chibachan|Kaihin|Makuhari|4,?500|\b180\b|https?:\/\/|<[@#][^>]*>|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/i
      );
    }
  );
  it.each(['ja', 'en'] as const)(
    'renders the complete adapted default within the message budget in %s',
    (locale) => {
      const panel = renderPanel(event, { confirmed: 4, now }, locale);
      const text = JSON.stringify(panel);
      const inspected = inspect(panel.components);
      expect(inspected.components).toBeLessThanOrEqual(40);
      expect(inspected.text).toBeLessThanOrEqual(4_000);
      expect(text).not.toContain(translator(locale)('panel_template.truncated'));
      expect(text).toContain(
        locale === 'ja' ? '当事者同士で責任を持って' : 'responsibility of those involved'
      );
      expect(text).not.toMatch(/\{(?:title|date|start|end|venue|fee|capacity|deadline)\}/);
      expect(text.split(event.title)).toHaveLength(2);
      expect(text).toContain(`<t:${Math.floor(event.startsAt.getTime() / 1000)}:F>`);
    }
  );
  it.each(['ja', 'en'] as const)(
    'bounds the adapted default with maximally long escaped event values in %s',
    (locale) => {
      const panel = renderPanel(
        {
          ...event,
          title: '\\'.repeat(200),
          venueName: '\\'.repeat(300),
          venueAddress: '\\'.repeat(500),
          capacity: Number.MAX_SAFE_INTEGER
        },
        { confirmed: 4, now },
        locale
      );
      const inspected = inspect(panel.components);
      expect(inspected.components).toBeLessThanOrEqual(40);
      expect(inspected.text).toBeLessThanOrEqual(4_000);
      expect(panel.allowed_mentions).toEqual({ parse: [] });
      expect(JSON.stringify(panel)).not.toContain(translator(locale)('panel_template.truncated'));
    }
  );
  it.each(['ja', 'en'] as const)(
    'enforces limits including worst-case text and five questions in %s',
    (locale) => {
      const long = {
        ...event,
        title: '*'.repeat(10_000),
        venueName: '@everyone'.repeat(500),
        venueAddress: '*'.repeat(5_000),
        description: '*'.repeat(20_000),
        panelTemplateJa: '{title} {venue} '.repeat(500),
        panelTemplateEn: '{title} {venue} '.repeat(500),
        cancellationPolicy: '*'.repeat(5_000)
      };
      const worst = {
        ...detail(),
        event: long,
        answers: Array.from({ length: 5 }, () => ({
          label: '*'.repeat(200),
          type: 'textarea' as const,
          valueText: '*'.repeat(5_000),
          valueBool: null,
          optionLabels: []
        }))
      };
      const responses = [
        renderPanel(long, { confirmed: 20, now }, locale),
        renderStatus(worst, event.id, locale).data,
        renderCancelConfirm(long, locale).data
      ];
      for (const response of responses) {
        const inspected = inspect(response.components);
        expect(inspected.components).toBeLessThanOrEqual(40);
        expect(inspected.text).toBeLessThanOrEqual(4_000);
        if (response === responses[0])
          expect(JSON.stringify(response)).toContain(
            locale === 'ja' ? '本文を省略' : 'Text shortened'
          );
        expect(response.allowed_mentions).toEqual({ parse: [] });
      }
      const modal = renderRegistrationModal(
        event.id,
        Array.from({ length: 5 }, (_, i) => ({ ...field('textarea'), key: `q${i}` })),
        locale,
        'join'
      );
      expect(modal.data.components).toHaveLength(5);
      expect(() =>
        renderRegistrationModal(
          event.id,
          Array.from({ length: 6 }, () => field('text')),
          locale,
          'join'
        )
      ).toThrow();
    }
  );
  it('hides private venue data and renders closed/full states without disabling waitlist join', () => {
    expect(
      JSON.stringify(
        renderPanel({ ...event, venueReveal: 'confirmed' }, { confirmed: 0, now }, 'en')
      )
    ).not.toContain('Tokyo');
    expect(JSON.stringify(renderPanel(event, { confirmed: 20, now }, 'en'))).toContain('Full');
    expect(
      JSON.stringify(renderPanel(event, { confirmed: 0, now: event.startsAt }, 'en'))
    ).toContain('closed');
    expect(
      JSON.stringify(
        renderStatus({ ...detail(), event: { ...event, venueReveal: 'confirmed' } }, event.id, 'en')
      )
    ).toContain('Tokyo');
  });
  it.each(formFieldTypes)('maps %s to a prefilled native modal component', (type) => {
    const expectedType = type === 'text' || type === 'textarea' ? 4 : type === 'select' ? 3 : 22;
    const value =
      type === 'text' || type === 'textarea'
        ? 'My saved answer'
        : type === 'select'
          ? 'a'
          : type === 'multiselect'
            ? ['a', 'b']
            : true;
    const response = renderRegistrationModal(event.id, [field(type)], 'en', 'edit', {
      question: value
    });
    expect(response).toMatchSnapshot(type);
    const label = response.data.components[0];
    expect(label.type).toBe(18);
    if (label.type !== 18) throw new Error('expected label');
    expect(label.component.type).toBe(expectedType);
    const submit = makeModalSubmit(response.data.custom_id);
    const component =
      expectedType === 4
        ? { type: 4 as const, custom_id: 'field:question', value: String(value) }
        : expectedType === 3
          ? { type: 3 as const, custom_id: 'field:question', values: [String(value)] }
          : {
              type: 22 as const,
              custom_id: 'field:question',
              values: Array.isArray(value) ? value : ['yes']
            };
    submit.data.components = [{ type: 18, component }];
    expect(submittedAnswers(submit, [field(type)])).toEqual({ question: value });
  });
});

it.each(['ja', 'en'] as const)(
  'keeps every paid state and controls within Discord limits in %s',
  (locale) => {
    for (const status of ['pending', 'payment_pending', 'paid', 'waived', 'refund_due'] as const) {
      const paidDetail = detail('held');
      paidDetail.event = {
        ...paidDetail.event,
        paymentRequirement: 'pay_later',
        title: '長い題名'.repeat(100)
      };
      paidDetail.registration.holdExpiresAt = new Date('2027-01-01');
      const request = {
        id: 'request',
        eventId: event.id,
        collectionId: 'collection',
        registrationId: paidDetail.registration.id,
        collectionPaymentMethodId: 'card',
        amountMinor: 99999999n,
        applicationFeeAmount: 100n,
        currency: 'JPY',
        status,
        dueAt: null,
        stripeAccountId: 'acct',
        checkoutSessionId: 'cs',
        checkoutAttempt: 1,
        checkoutExpiresAt: new Date('2027-01-01'),
        checkoutUrl: '',
        paymentIntentId: '',
        chargeType: 'direct',
        createdAt: now,
        updatedAt: now
      };
      const rendered = renderStatus(paidDetail, event.id, locale, {
        request,
        checkoutUrl: 'https://checkout.stripe.test/session',
        manualMethods: [
          'payments.default_method.cash.label',
          'payments.default_method.paypay.label'
        ]
      });
      const data = JSON.stringify(rendered);
      if (['pending', 'payment_pending'].includes(status))
        expect(data).toContain('https://checkout.stripe.test/session');
      else expect(data).not.toContain('https://checkout.stripe.test/session');
      expect(data).toContain(':R>');
      expect(data).not.toMatch(/undefined|NaN|\[object Object\]/);
      const text =
        rendered.data.components
          ?.flatMap((container) =>
            'components' in container
              ? container.components.flatMap((component) =>
                  component.type === 10 ? [component.content] : []
                )
              : []
          )
          .join('') ?? '';
      expect(text.length).toBeLessThanOrEqual(4000);
    }
  }
);

it.each(['ja', 'en'] as const)('links paid panels to the organizer disclosure in %s', (locale) => {
  const panel = renderPanel(
    { ...event, paymentRequirement: 'pay_later', priceMinor: 5000n },
    { confirmed: 1, now, publicBaseUrl: 'https://example.test' },
    locale
  );
  expect(JSON.stringify(panel)).toContain(`https://example.test/legal/${event.organizationId}`);
  expect(JSON.stringify(panel)).toContain(translator(locale)('legal.title'));
});
