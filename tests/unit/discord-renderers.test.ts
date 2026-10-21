import { describe, expect, it } from 'vitest';
import { renderPanel, renderStatus, renderCancelConfirm } from '$lib/server/interactions/renderers';
import { renderRegistrationModal, submittedAnswers } from '$lib/server/interactions/modal';
import type { EventSummary, RegistrationFormField } from '$lib/server/domain/events';
import type { OwnedRegistrationDetail } from '$lib/server/domain/registrations/participant';
import { formFieldTypes } from '$lib/shared/registration-form';
import { makeModalSubmit } from '../support/interactions';

const event: EventSummary = {
  id: '12345678-1234-4234-8234-123456789012',
  organizationId: '12345678-1234-4234-8234-123456789013',
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
  it.each(['ja', 'en'] as const)(
    'enforces limits including worst-case text and five questions in %s',
    (locale) => {
      const long = {
        ...event,
        title: '*'.repeat(10_000),
        venueName: '@everyone'.repeat(500),
        venueAddress: '*'.repeat(5_000),
        description: '*'.repeat(20_000),
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
