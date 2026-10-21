import {
  CheckboxGroupBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder
} from '@discordjs/builders';
import type { APIModalSubmitInteraction, APIModalInteractionResponse } from 'discord-api-types/v10';
import { translator, type Locale } from '$lib/i18n';
import type { RegistrationFormField } from '$lib/server/domain/events/forms';
import { discordLimits } from '$lib/shared/discord-limits';
import { registrationTextLimit } from '$lib/shared/registration-form';
import type { DraftKind } from '$lib/server/domain/discord/drafts';
import { encodeCustomId } from './custom-id';
import { excerpt } from './renderers';

export class ModalLimitError extends Error {}
export function assertModalFields(fields: readonly RegistrationFormField[]): void {
  if (
    fields.length > discordLimits.modalComponents ||
    fields.some(
      (field) =>
        (field.type === 'select' &&
          (field.options.length === 0 || field.options.length > discordLimits.selectOptions)) ||
        (field.type === 'multiselect' &&
          (field.options.length === 0 || field.options.length > discordLimits.checkboxOptions))
    )
  )
    throw new ModalLimitError('form exceeds Discord limits');
}
export function renderRegistrationModal(
  eventId: string,
  fields: readonly RegistrationFormField[],
  locale: Locale,
  kind: DraftKind,
  data: Record<string, unknown> = {}
): APIModalInteractionResponse {
  assertModalFields(fields);
  const t = translator(locale);
  const components = fields.map((field) => {
    const label = new LabelBuilder().setLabel(excerpt(field.label, 45));
    if (field.helpText) label.setDescription(excerpt(field.helpText, 100));
    const customId = `field:${field.key}`;
    switch (field.type) {
      case 'text':
      case 'textarea': {
        const input = new TextInputBuilder()
          .setCustomId(customId)
          .setStyle(field.type === 'text' ? 1 : 2)
          .setRequired(field.required)
          .setMaxLength(field.type === 'text' ? registrationTextLimit : discordLimits.textInput);
        const value = typeof data[field.key] === 'string' ? (data[field.key] as string) : '';
        if (value)
          input.setValue(
            excerpt(value, field.type === 'text' ? registrationTextLimit : discordLimits.textInput)
          );
        return label.setTextInputComponent(input);
      }
      case 'select':
        return label.setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setRequired(field.required)
            .setMinValues(field.required ? 1 : 0)
            .setMaxValues(1)
            .addOptions(
              field.options.map((option) => ({
                label: excerpt(option.label, 100),
                value: option.id,
                default: data[field.key] === option.id
              }))
            )
        );
      case 'multiselect':
        return label.setCheckboxGroupComponent(
          new CheckboxGroupBuilder()
            .setCustomId(customId)
            .setRequired(field.required)
            .setMinValues(field.required ? 1 : 0)
            .setMaxValues(field.options.length)
            .addOptions(
              field.options.map((option) => ({
                label: excerpt(option.label, 100),
                value: option.id,
                default:
                  Array.isArray(data[field.key]) &&
                  (data[field.key] as unknown[]).includes(option.id)
              }))
            )
        );
      case 'checkbox':
      case 'consent':
        return label.setCheckboxGroupComponent(
          new CheckboxGroupBuilder()
            .setCustomId(customId)
            .setRequired(field.type === 'consent' || field.required)
            .setMinValues(field.type === 'consent' || field.required ? 1 : 0)
            .setMaxValues(1)
            .addOptions({
              label: t(field.type === 'consent' ? 'participant.agree' : 'participant.yes'),
              value: 'yes',
              default: data[field.key] === true
            })
        );
      default:
        return field.type satisfies never;
    }
  });
  return {
    type: 9,
    data: new ModalBuilder()
      .setCustomId(
        encodeCustomId({ action: kind === 'join' ? 'join_submit' : 'edit_submit', args: [eventId] })
      )
      .setTitle(t(kind === 'join' ? 'participant.form_title' : 'participant.edit_title'))
      .addLabelComponents(components)
      .toJSON()
  };
}

/** Parse Discord's submitted values, including Labels and the legacy ActionRow text envelope. */
export function submittedAnswers(
  interaction: APIModalSubmitInteraction,
  fields: readonly RegistrationFormField[]
): Record<string, unknown> {
  const entries = interaction.data.components.flatMap((row) =>
    row.type === 18 ? [row.component] : row.type === 1 ? row.components : []
  );
  const values = new Map(entries.map((component) => [component.custom_id, component]));
  const raw = Object.fromEntries(
    entries
      .filter((component) => component.custom_id.startsWith('field:'))
      .map((component) => [
        component.custom_id.slice(6),
        'value' in component ? component.value : 'values' in component ? component.values : null
      ])
  );
  return {
    ...raw,
    ...Object.fromEntries(
      fields.map((field) => {
        const component = values.get(`field:${field.key}`);
        const value = component && 'value' in component ? component.value : undefined;
        const selected = component && 'values' in component ? component.values : [];
        return [
          field.key,
          field.type === 'text' || field.type === 'textarea'
            ? (value ?? '')
            : field.type === 'select'
              ? (selected[0] ?? '')
              : field.type === 'multiselect'
                ? selected
                : selected.includes('yes')
        ];
      })
    )
  };
}

/** An unchanged Discord excerpt must not truncate preexisting domain-valid long answers. */
export function retainUnchangedLongAnswers(
  fields: readonly RegistrationFormField[],
  submitted: Record<string, unknown>,
  original: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...submitted,
    ...Object.fromEntries(
      fields.map((field) => {
        const saved = original[field.key];
        return [
          field.key,
          field.type === 'textarea' &&
          typeof saved === 'string' &&
          saved.length > discordLimits.textInput &&
          submitted[field.key] === excerpt(saved, discordLimits.textInput)
            ? saved
            : submitted[field.key]
        ];
      })
    )
  };
}
