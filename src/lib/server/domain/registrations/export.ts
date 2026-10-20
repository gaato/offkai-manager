import { read } from '$lib/server/db/client';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import {
  eventFormFieldOptions,
  eventFormFields,
  events,
  externalAccounts,
  registrationFormAnswerOptions,
  registrationFormAnswers,
  registrations
} from '$lib/server/db/schema';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { formFieldTypeSchema, type FormFieldType } from '$lib/shared/registration-form';
import { registrationStatusSchema, type RegistrationStatus } from '$lib/shared/registration';
import { RegistrationError } from './errors';

export interface ParticipantExportField {
  id: string;
  label: string;
  type: FormFieldType;
}

export interface ParticipantExportAnswer {
  fieldId: string;
  type: FormFieldType;
  valueText: string;
  valueBool: boolean | null;
  optionLabels: string[];
}

export interface ParticipantExportRow {
  id: string;
  displayName: string;
  username: string;
  status: RegistrationStatus;
  registeredAt: Date;
  answers: ParticipantExportAnswer[];
}

export interface ParticipantExport {
  fields: ParticipantExportField[];
  rows: ParticipantExportRow[];
}

/** Returns staff-authorized export data with current active columns and snapshot answer values. */
export async function participantExport(
  client: DatabaseClient,
  actorUserId: string,
  eventId: string
): Promise<ParticipantExport> {
  return read(client, (tx) => {
    const eventRows = tx
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)
      .all();
    if (!eventRows[0]) throw new RegistrationError('not_found', 'event not found');
    authorizeOrganizationRole(tx, eventRows[0].organizationId, actorUserId, 'staff', true);
    const fields = tx
      .select()
      .from(eventFormFields)
      .where(and(eq(eventFormFields.eventId, eventId), isNull(eventFormFields.archivedAt)))
      .orderBy(asc(eventFormFields.position), asc(eventFormFields.id))
      .all();
    const registrationsRows = tx
      .select({
        id: registrations.id,
        displayName: registrations.displayNameSnapshot,
        username: externalAccounts.username,
        status: registrations.status,
        registeredAt: registrations.createdAt
      })
      .from(registrations)
      .leftJoin(
        externalAccounts,
        and(
          eq(externalAccounts.userId, registrations.userId),
          eq(externalAccounts.provider, 'discord')
        )
      )
      .where(eq(registrations.eventId, eventId))
      .orderBy(asc(registrations.createdAt), asc(registrations.id))
      .all();
    const registrationIds = registrationsRows.map(({ id }) => id);
    const answerRows =
      registrationIds.length === 0
        ? []
        : tx
            .select()
            .from(registrationFormAnswers)
            .where(inArray(registrationFormAnswers.registrationId, registrationIds))
            .all();
    const answerIds = answerRows.map(({ id }) => id);
    const optionRows =
      answerIds.length === 0
        ? []
        : tx
            .select({
              answerId: registrationFormAnswerOptions.answerId,
              label: registrationFormAnswerOptions.optionLabelSnapshot
            })
            .from(registrationFormAnswerOptions)
            .innerJoin(
              eventFormFieldOptions,
              eq(eventFormFieldOptions.id, registrationFormAnswerOptions.optionId)
            )
            .where(inArray(registrationFormAnswerOptions.answerId, answerIds))
            .orderBy(
              asc(registrationFormAnswerOptions.answerId),
              asc(eventFormFieldOptions.position),
              asc(eventFormFieldOptions.id)
            )
            .all();
    const optionLabels = new Map<string, string[]>();
    for (const option of optionRows) {
      const labels = optionLabels.get(option.answerId) ?? [];
      labels.push(option.label);
      optionLabels.set(option.answerId, labels);
    }
    const answersByRegistration = new Map<string, ParticipantExportAnswer[]>();
    for (const answer of answerRows) {
      const answers = answersByRegistration.get(answer.registrationId) ?? [];
      answers.push({
        fieldId: answer.fieldId,
        type: formFieldTypeSchema.parse(answer.fieldTypeSnapshot),
        valueText: answer.valueText,
        valueBool: answer.valueBool,
        optionLabels: optionLabels.get(answer.id) ?? []
      });
      answersByRegistration.set(answer.registrationId, answers);
    }
    return {
      fields: fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: formFieldTypeSchema.parse(field.fieldType)
      })),
      rows: registrationsRows.map((row) => ({
        ...row,
        username: row.username ?? '',
        status: registrationStatusSchema.parse(row.status),
        answers: answersByRegistration.get(row.id) ?? []
      }))
    };
  });
}
