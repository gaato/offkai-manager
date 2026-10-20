import { z } from 'zod';

export const formFieldTypes = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'checkbox',
  'consent'
] as const;
export const formFieldTypeSchema = z.enum(formFieldTypes);
export type FormFieldType = z.infer<typeof formFieldTypeSchema>;

export const registrationTextLimit = 500;
export const registrationTextareaLimit = 5_000;

export function formFieldTypeLabelKey(
  type: FormFieldType
): `registration_form.type.${FormFieldType}` {
  return `registration_form.type.${type}`;
}
