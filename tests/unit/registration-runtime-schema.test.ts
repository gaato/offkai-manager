import { describe, expect, it } from 'vitest';
import type { RegistrationFormField } from '$lib/server/domain/events';
import {
  buildRegistrationSchema,
  registrationAnswersFromData
} from '$lib/server/domain/registrations';

const fields = [
  field('short_text', 'text', true),
  field('long_text', 'textarea', false),
  field('meal', 'select', true, [option('meal-1'), option('meal-2')]),
  field('topics', 'multiselect', false, [option('topic-1'), option('topic-2')]),
  field('badge', 'checkbox', false),
  field('policy', 'consent', true)
];

const schema = buildRegistrationSchema(fields, {
  required: 'required',
  tooLong: (maximum) => `maximum ${maximum}`,
  invalidOption: 'invalid option',
  consentRequired: 'consent required'
});

describe('runtime registration schema', () => {
  it('parses every supported field and converts it to snapshot input', () => {
    const data = schema.parse({
      short_text: ' Display name ',
      long_text: 'Access notes',
      meal: 'meal-2',
      topics: ['topic-1', 'topic-2'],
      badge: true,
      policy: true
    });
    expect(data.short_text).toBe('Display name');
    expect(registrationAnswersFromData(fields, data)).toEqual([
      { fieldKey: 'short_text', valueText: 'Display name', valueBool: null, optionIds: [] },
      { fieldKey: 'long_text', valueText: 'Access notes', valueBool: null, optionIds: [] },
      { fieldKey: 'meal', valueText: '', valueBool: null, optionIds: ['meal-2'] },
      {
        fieldKey: 'topics',
        valueText: '',
        valueBool: null,
        optionIds: ['topic-1', 'topic-2']
      },
      { fieldKey: 'badge', valueText: '', valueBool: true, optionIds: [] },
      { fieldKey: 'policy', valueText: '', valueBool: true, optionIds: [] }
    ]);
  });
  it('rejects option values outside the current definition', () => {
    const result = schema.safeParse({
      short_text: 'Name',
      meal: 'removed-option',
      policy: true
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(({ message }) => message === 'invalid option')).toBe(true);
  });
  it('rejects false consent and overlong text', () => {
    const consent = schema.safeParse({ short_text: 'Name', meal: 'meal-1', policy: false });
    expect(consent.success).toBe(false);
    expect(consent.error?.issues.some(({ message }) => message === 'consent required')).toBe(true);
    const text = schema.safeParse({
      short_text: 'x'.repeat(501),
      meal: 'meal-1',
      policy: true
    });
    expect(text.success).toBe(false);
    expect(text.error?.issues.some(({ message }) => message === 'maximum 500')).toBe(true);
  });
});

function field(
  key: string,
  type: RegistrationFormField['type'],
  required: boolean,
  options: RegistrationFormField['options'] = []
): RegistrationFormField {
  return {
    id: `field-${key}`,
    eventId: 'event-id',
    key,
    label: key,
    type,
    required,
    position: 10,
    helpText: '',
    archivedAt: null,
    options
  };
}

function option(id: string): RegistrationFormField['options'][number] {
  return { id, key: id, label: id, position: 10 };
}
