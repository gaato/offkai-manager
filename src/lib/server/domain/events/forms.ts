import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { translate, type MessageKey } from '$lib/i18n';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import { eventFormFieldOptions, eventFormFields, events } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { formFieldTypeSchema, type FormFieldType } from '$lib/shared/registration-form';
import { EventError } from './errors';

export interface RegistrationFormOption {
  id: string;
  key: string;
  label: string;
  position: number;
}

export interface RegistrationFormField {
  id: string;
  eventId: string;
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  position: number;
  helpText: string;
  archivedAt: Date | null;
  options: RegistrationFormOption[];
}

export interface UpsertFormFieldInput {
  actorUserId: string;
  eventId: string;
  fieldId?: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  position?: number;
  helpText?: string;
  optionLabels?: string[];
}

export interface FormFieldMutationInput {
  actorUserId: string;
  eventId: string;
  fieldId: string;
}

export type ReorderDirection = 'up' | 'down';

export type PresetLocale = 'en' | 'ja';

export const formPresetKeys = [
  'x_handle',
  'interests',
  'allergies',
  'photo_policy',
  'notes',
  'terms_consent'
] as const;

export type FormPresetKey = (typeof formPresetKeys)[number];

interface FormPreset {
  key: FormPresetKey;
  labelKey: MessageKey;
  type: FormFieldType;
  required?: boolean;
  helpTextKey?: MessageKey;
  optionKeys?: readonly MessageKey[];
}

export const formPresets: readonly FormPreset[] = [
  {
    key: 'x_handle',
    labelKey: 'registration_form.preset.x_handle',
    type: 'text',
    helpTextKey: 'registration_form.preset.x_handle_help'
  },
  {
    key: 'interests',
    labelKey: 'registration_form.preset.interests',
    type: 'text',
    helpTextKey: 'registration_form.preset.interests_help'
  },
  {
    key: 'allergies',
    labelKey: 'registration_form.preset.allergies',
    type: 'textarea'
  },
  {
    key: 'photo_policy',
    labelKey: 'registration_form.preset.photo_policy',
    type: 'select',
    optionKeys: [
      'registration_form.preset.photo_ok',
      'registration_form.preset.photo_ask',
      'registration_form.preset.photo_no'
    ]
  },
  {
    key: 'notes',
    labelKey: 'registration_form.preset.notes',
    type: 'textarea'
  },
  {
    key: 'terms_consent',
    labelKey: 'registration_form.preset.terms_consent',
    type: 'consent',
    required: true
  }
];

/** Derives a readable form key once; persisted keys are never changed when labels are edited. */
export function deriveFieldKey(label: string): string {
  const normalized = label
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/&/g, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
    .replace(/_+$/g, '');
  return normalized || 'field';
}

/** Lists the form definition for any active organization member. */
export async function listFormFields(
  client: DatabaseClient,
  actorUserId: string,
  eventId: string,
  includeArchived = false
): Promise<RegistrationFormField[]> {
  return read(client, (tx) => {
    const event = loadEventForForm(tx, eventId);
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'viewer', true);
    return loadFields(tx, eventId, includeArchived);
  });
}

/** Loads the participant-facing active definition inside an existing domain transaction. */
export function loadActiveFormFields(
  tx: DatabaseTransaction,
  eventId: string
): RegistrationFormField[] {
  return loadFields(tx, eventId, false);
}

/** Creates a field or edits it without changing its persisted key. */
export async function upsertField(
  client: DatabaseClient,
  input: UpsertFormFieldInput,
  clock: Clock = systemClock
): Promise<RegistrationFormField> {
  const values = validateFieldInput(input);
  return write(client, (tx) => {
    authorizeMutableForm(tx, input.eventId, input.actorUserId);
    return upsertFieldInTransaction(tx, input, values, undefined, clock);
  });
}

/** Archives a field permanently while retaining its answer snapshots. */
export async function archiveField(
  client: DatabaseClient,
  input: FormFieldMutationInput,
  clock: Clock = systemClock
): Promise<void> {
  write(client, (tx) => {
    authorizeMutableForm(tx, input.eventId, input.actorUserId);
    const rows = tx
      .select()
      .from(eventFormFields)
      .where(
        and(
          eq(eventFormFields.id, input.fieldId),
          eq(eventFormFields.eventId, input.eventId),
          isNull(eventFormFields.archivedAt)
        )
      )
      .all();
    const current = rows[0];
    if (!current) throw new EventError('not_found', 'form field not found');
    const archivedAt = clock.now();
    tx.update(eventFormFields)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(eq(eventFormFields.id, current.id))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'event.form_field_archive',
        targetType: 'event_form_field',
        targetId: current.id,
        before: fieldAuditSnapshot(current),
        after: { ...fieldAuditSnapshot(current), archivedAt: archivedAt.toISOString() }
      },
      clock
    );
  });
}

/** Moves a field by swapping positions with its adjacent active neighbor. */
export async function reorderField(
  client: DatabaseClient,
  input: FormFieldMutationInput & {
    direction: ReorderDirection;
  },
  clock: Clock = systemClock
): Promise<boolean> {
  return write(client, (tx) => {
    authorizeMutableForm(tx, input.eventId, input.actorUserId);
    const rows = tx
      .select()
      .from(eventFormFields)
      .where(and(eq(eventFormFields.eventId, input.eventId), isNull(eventFormFields.archivedAt)))
      .orderBy(asc(eventFormFields.position), asc(eventFormFields.createdAt))
      .all();
    const index = rows.findIndex((row) => row.id === input.fieldId);
    if (index < 0) throw new EventError('not_found', 'form field not found');
    const neighborIndex = input.direction === 'up' ? index - 1 : index + 1;
    const neighbor = rows[neighborIndex];
    if (!neighbor) return false;
    const current = rows[index];
    const changedAt = clock.now();
    tx.update(eventFormFields)
      .set({ position: neighbor.position, updatedAt: changedAt })
      .where(eq(eventFormFields.id, current.id))
      .run();
    tx.update(eventFormFields)
      .set({ position: current.position, updatedAt: changedAt })
      .where(eq(eventFormFields.id, neighbor.id))
      .run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        action: 'event.form_field_reorder',
        targetType: 'event_form_field',
        targetId: current.id,
        before: { position: current.position, adjacentFieldId: neighbor.id },
        after: { position: neighbor.position, adjacentFieldId: neighbor.id }
      },
      clock
    );
    return true;
  });
}

/** Adds one localized legacy preset. Existing active or archived preset keys are a no-op. */
export async function addFormPreset(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    presetKey: FormPresetKey;
    locale: PresetLocale;
  },
  clock: Clock = systemClock
): Promise<{
  created: boolean;
  field: RegistrationFormField | null;
}> {
  const preset = formPresets.find(({ key }) => key === input.presetKey);
  if (!preset) throw new EventError('validation', 'unknown form preset');
  const label = translate(input.locale, preset.labelKey);
  const helpText = preset.helpTextKey ? translate(input.locale, preset.helpTextKey) : '';
  const optionLabels = preset.optionKeys?.map((key) => translate(input.locale, key)) ?? [];
  return write(client, (tx) => {
    authorizeMutableForm(tx, input.eventId, input.actorUserId);
    const existing = tx
      .select({ id: eventFormFields.id })
      .from(eventFormFields)
      .where(
        and(eq(eventFormFields.eventId, input.eventId), eq(eventFormFields.fieldKey, preset.key))
      )
      .limit(1)
      .all();
    if (existing[0]) return { created: false, field: null };
    const field = upsertFieldInTransaction(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        label,
        type: preset.type,
        required: preset.required ?? false,
        helpText,
        optionLabels
      },
      validateFieldInput({
        actorUserId: input.actorUserId,
        eventId: input.eventId,
        label,
        type: preset.type,
        required: preset.required ?? false,
        helpText,
        optionLabels
      }),
      preset.key,
      clock
    );
    return { created: true, field };
  });
}

function validateFieldInput(input: UpsertFormFieldInput) {
  const label = input.label.trim();
  if (!label || label.length > 200) {
    throw new EventError('validation', 'field label must be 1 to 200 characters');
  }
  const parsedType = formFieldTypeSchema.safeParse(input.type);
  if (!parsedType.success) throw new EventError('validation', 'form field type is invalid');
  if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 1)) {
    throw new EventError('validation', 'field position must be a positive integer');
  }
  const helpText = (input.helpText ?? '').trim();
  const optionLabels = (input.optionLabels ?? []).map((option) => option.trim()).filter(Boolean);
  if (optionLabels.some((option) => option.length > 200)) {
    throw new EventError('validation', 'option labels must be 200 characters or fewer');
  }
  if (
    (parsedType.data === 'select' || parsedType.data === 'multiselect') &&
    optionLabels.length === 0
  ) {
    throw new EventError('validation', 'select fields need at least one option');
  }
  return {
    label,
    type: parsedType.data,
    required: parsedType.data === 'consent' ? true : input.required,
    position: input.position,
    helpText,
    optionLabels:
      parsedType.data === 'select' || parsedType.data === 'multiselect' ? optionLabels : []
  };
}

function authorizeMutableForm(tx: DatabaseTransaction, eventId: string, actorUserId: string) {
  const event = loadEventForForm(tx, eventId);
  authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'organizer');
  if (event.cancelledAt || event.archivedAt) {
    throw new EventError('illegal_transition', 'cancelled or archived event forms are frozen');
  }
  return event;
}

function loadEventForForm(tx: DatabaseTransaction, eventId: string) {
  const query = tx
    .select({
      id: events.id,
      organizationId: events.organizationId,
      cancelledAt: events.cancelledAt,
      archivedAt: events.archivedAt
    })
    .from(events)
    .where(eq(events.id, eventId));
  const rows = query.all();
  if (!rows[0]) throw new EventError('not_found', 'event not found');
  return rows[0];
}

function upsertFieldInTransaction(
  tx: DatabaseTransaction,
  input: UpsertFormFieldInput,
  values: ReturnType<typeof validateFieldInput>,
  fixedKey?: string,
  clock: Clock = systemClock
): RegistrationFormField {
  let fieldRow: typeof eventFormFields.$inferSelect;
  let before: ReturnType<typeof fieldAuditSnapshot> | undefined;
  if (input.fieldId) {
    const currentRows = tx
      .select()
      .from(eventFormFields)
      .where(
        and(
          eq(eventFormFields.id, input.fieldId),
          eq(eventFormFields.eventId, input.eventId),
          isNull(eventFormFields.archivedAt)
        )
      )
      .all();
    const current = currentRows[0];
    if (!current) throw new EventError('not_found', 'form field not found');
    before = fieldAuditSnapshot(current);
    const updated = tx
      .update(eventFormFields)
      .set({
        label: values.label,
        fieldType: values.type,
        required: values.required,
        position: values.position ?? current.position,
        helpText: values.helpText,
        updatedAt: clock.now()
      })
      .where(eq(eventFormFields.id, current.id))
      .returning()
      .all();
    fieldRow = updated[0];
  } else {
    const position = values.position ?? nextFieldPosition(tx, input.eventId);
    const key = fixedKey ?? uniqueFieldKey(tx, input.eventId, deriveFieldKey(values.label));
    const inserted = tx
      .insert(eventFormFields)
      .values({
        createdAt: clock.now(),
        updatedAt: clock.now(),
        eventId: input.eventId,
        fieldKey: key,
        label: values.label,
        fieldType: values.type,
        required: values.required,
        position,
        helpText: values.helpText
      })
      .returning()
      .all();
    fieldRow = inserted[0];
  }
  const changedAt = clock.now();
  tx.update(eventFormFieldOptions)
    .set({ archivedAt: changedAt, updatedAt: changedAt })
    .where(
      and(eq(eventFormFieldOptions.fieldId, fieldRow.id), isNull(eventFormFieldOptions.archivedAt))
    )
    .run();
  const optionRows: (typeof eventFormFieldOptions.$inferSelect)[] = [];
  for (const [index, label] of values.optionLabels.entries()) {
    const optionKey = `opt_${index + 1}`;
    const rows = tx
      .insert(eventFormFieldOptions)
      .values({
        createdAt: clock.now(),
        updatedAt: clock.now(),
        fieldId: fieldRow.id,
        optionKey,
        label,
        position: (index + 1) * 10,
        archivedAt: null
      })
      .onConflictDoUpdate({
        target: [eventFormFieldOptions.fieldId, eventFormFieldOptions.optionKey],
        set: { label, position: (index + 1) * 10, archivedAt: null, updatedAt: changedAt }
      })
      .returning()
      .all();
    optionRows.push(rows[0]);
  }
  const field = parseField(fieldRow, optionRows);
  appendAudit(
    tx,
    {
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      action: 'event.form_field_upsert',
      targetType: 'event_form_field',
      targetId: field.id,
      before,
      after: fieldAuditSnapshot(fieldRow)
    },
    clock
  );
  return field;
}

function nextFieldPosition(tx: DatabaseTransaction, eventId: string): number {
  const rows = tx
    .select({ position: eventFormFields.position })
    .from(eventFormFields)
    .where(eq(eventFormFields.eventId, eventId))
    .orderBy(asc(eventFormFields.position))
    .all();
  return (rows.at(-1)?.position ?? 0) + 10;
}

function uniqueFieldKey(tx: DatabaseTransaction, eventId: string, base: string): string {
  const rows = tx
    .select({ key: eventFormFields.fieldKey })
    .from(eventFormFields)
    .where(eq(eventFormFields.eventId, eventId))
    .all();
  const keys = new Set(rows.map(({ key }) => key));
  if (!keys.has(base)) return base;
  let suffix = 2;
  while (keys.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function loadFields(
  tx: DatabaseTransaction,
  eventId: string,
  includeArchived: boolean
): RegistrationFormField[] {
  const fieldRows = tx
    .select()
    .from(eventFormFields)
    .where(
      includeArchived
        ? eq(eventFormFields.eventId, eventId)
        : and(eq(eventFormFields.eventId, eventId), isNull(eventFormFields.archivedAt))
    )
    .orderBy(asc(eventFormFields.position), asc(eventFormFields.createdAt))
    .all();
  if (fieldRows.length === 0) return [];
  const optionRows = tx
    .select()
    .from(eventFormFieldOptions)
    .where(
      and(
        inArray(
          eventFormFieldOptions.fieldId,
          fieldRows.map(({ id }) => id)
        ),
        isNull(eventFormFieldOptions.archivedAt)
      )
    )
    .orderBy(asc(eventFormFieldOptions.position), asc(eventFormFieldOptions.createdAt))
    .all();
  const optionsByField = new Map<string, (typeof eventFormFieldOptions.$inferSelect)[]>();
  for (const option of optionRows) {
    const options = optionsByField.get(option.fieldId) ?? [];
    options.push(option);
    optionsByField.set(option.fieldId, options);
  }
  return fieldRows.map((field) => parseField(field, optionsByField.get(field.id) ?? []));
}

function parseField(
  row: typeof eventFormFields.$inferSelect,
  options: (typeof eventFormFieldOptions.$inferSelect)[]
): RegistrationFormField {
  return {
    id: row.id,
    eventId: row.eventId,
    key: row.fieldKey,
    label: row.label,
    type: formFieldTypeSchema.parse(row.fieldType),
    required: row.required,
    position: row.position,
    helpText: row.helpText,
    archivedAt: row.archivedAt,
    options: options.map((option) => ({
      id: option.id,
      key: option.optionKey,
      label: option.label,
      position: option.position
    }))
  };
}

function fieldAuditSnapshot(row: typeof eventFormFields.$inferSelect) {
  return {
    key: row.fieldKey,
    label: row.label,
    type: row.fieldType,
    required: row.required,
    position: row.position,
    helpText: row.helpText,
    archivedAt: row.archivedAt?.toISOString() ?? null
  };
}
