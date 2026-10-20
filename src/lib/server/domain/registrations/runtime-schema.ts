import { z } from 'zod';
import type { RegistrationFormField } from '$lib/server/domain/events';
import { registrationTextLimit, registrationTextareaLimit } from '$lib/shared/registration-form';

export interface RuntimeSchemaMessages {
  required: string;
  tooLong: (maximum: number) => string;
  invalidOption: string;
  consentRequired: string;
}

export interface RegistrationAnswerInput {
  fieldKey: string;
  valueText: string;
  valueBool: boolean | null;
  optionIds: string[];
}

export function buildRegistrationSchema(
  fields: readonly RegistrationFormField[],
  messages: RuntimeSchemaMessages
) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const optionIds = new Set(field.options.map(({ id }) => id));
    switch (field.type) {
      case 'text':
      case 'textarea': {
        const maximum = field.type === 'text' ? registrationTextLimit : registrationTextareaLimit;
        let schema = z.string().trim().max(maximum, messages.tooLong(maximum));
        if (field.required) schema = schema.min(1, messages.required);
        shape[field.key] = schema.default('');
        break;
      }
      case 'select': {
        const validOption = z
          .string()
          .refine((value) => optionIds.has(value), messages.invalidOption);
        shape[field.key] = field.required
          ? validOption.refine(Boolean, messages.required)
          : z.union([z.literal(''), validOption]).default('');
        break;
      }
      case 'multiselect': {
        let schema = z
          .array(z.string().refine((value) => optionIds.has(value), messages.invalidOption))
          .refine((values) => new Set(values).size === values.length, messages.invalidOption);
        if (field.required) schema = schema.min(1, messages.required);
        shape[field.key] = schema.default([]);
        break;
      }
      case 'consent':
        shape[field.key] = z
          .boolean()
          .default(false)
          .refine((value) => value, messages.consentRequired);
        break;
      case 'checkbox': {
        let schema = z.boolean().default(false);
        if (field.required) schema = schema.refine((value) => value, messages.required);
        shape[field.key] = schema;
        break;
      }
    }
  }
  return z.object(shape);
}

export function registrationAnswersFromData(
  fields: readonly RegistrationFormField[],
  data: Record<string, unknown>
): RegistrationAnswerInput[] {
  return fields.map((field) => {
    const value = data[field.key];
    return {
      fieldKey: field.key,
      valueText: field.type === 'text' || field.type === 'textarea' ? String(value ?? '') : '',
      valueBool: field.type === 'checkbox' || field.type === 'consent' ? Boolean(value) : null,
      optionIds:
        field.type === 'select'
          ? value
            ? [String(value)]
            : []
          : field.type === 'multiselect' && Array.isArray(value)
            ? value.map(String)
            : []
    };
  });
}

export function validateRegistrationAnswers(
  fields: readonly RegistrationFormField[],
  answers: readonly RegistrationAnswerInput[]
): void {
  const byKey = new Map(answers.map((answer) => [answer.fieldKey, answer]));
  if (byKey.size !== answers.length || answers.length !== fields.length) {
    throw new Error('registration answers do not match the active form');
  }
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const answer = byKey.get(field.key);
    if (!answer) throw new Error('registration answer is missing');
    data[field.key] =
      field.type === 'text' || field.type === 'textarea'
        ? answer.valueText
        : field.type === 'checkbox' || field.type === 'consent'
          ? (answer.valueBool ?? false)
          : field.type === 'select'
            ? (answer.optionIds[0] ?? '')
            : answer.optionIds;
  }
  const result = buildRegistrationSchema(fields, {
    required: 'required answer is missing',
    tooLong: (maximum) => `answer exceeds ${maximum} characters`,
    invalidOption: 'answer contains an invalid option',
    consentRequired: 'consent is required'
  }).safeParse(data);
  if (!result.success) throw new Error('registration answers are invalid', { cause: result.error });
}
