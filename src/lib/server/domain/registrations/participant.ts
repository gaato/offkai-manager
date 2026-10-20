import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import {
  eventFormFields,
  events,
  organizations,
  registrationFormAnswerOptions,
  registrationFormAnswers,
  registrations
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { enqueueRoleSync } from '$lib/server/domain/discord';
import type { EventSummary } from '$lib/server/domain/events';
import { cancelPaymentRequestsForRegistration } from '$lib/server/domain/payments';
import {
  discordPolicySchema,
  eventVisibilitySchema,
  registrationModeSchema,
  venueRevealSchema
} from '$lib/shared/event';
import { formFieldTypeSchema, type FormFieldType } from '$lib/shared/registration-form';
import { registrationStatusSchema } from '$lib/shared/registration';
import { RegistrationError } from './errors';
import { promoteOldestWaitlisted } from './promotion';
import type { RegistrationSummary } from './service';

export interface RegistrationAnswerView {
  label: string;
  type: FormFieldType;
  valueText: string;
  valueBool: boolean | null;
  optionLabels: string[];
}

export interface OwnedRegistrationDetail {
  registration: RegistrationSummary;
  event: EventSummary;
  organizationName: string;
  answers: RegistrationAnswerView[];
}

export async function getOwnedRegistration(
  client: DatabaseClient,
  registrationId: string,
  userId: string
): Promise<OwnedRegistrationDetail> {
  const rows = await client.db
    .select({
      registration: registrations,
      event: events,
      organizationName: organizations.name
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(and(eq(registrations.id, registrationId), eq(registrations.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new RegistrationError('not_found', 'registration not found');

  const answerRows = await client.db
    .select({ answer: registrationFormAnswers, position: eventFormFields.position })
    .from(registrationFormAnswers)
    .innerJoin(eventFormFields, eq(eventFormFields.id, registrationFormAnswers.fieldId))
    .where(eq(registrationFormAnswers.registrationId, registrationId))
    .orderBy(asc(eventFormFields.position), asc(registrationFormAnswers.id));
  const answerIds = answerRows.map(({ answer }) => answer.id);
  const optionRows =
    answerIds.length === 0
      ? []
      : await client.db
          .select()
          .from(registrationFormAnswerOptions)
          .where(inArray(registrationFormAnswerOptions.answerId, answerIds));
  const optionsByAnswer = new Map<string, string[]>();
  for (const option of optionRows) {
    const labels = optionsByAnswer.get(option.answerId) ?? [];
    labels.push(option.optionLabelSnapshot);
    optionsByAnswer.set(option.answerId, labels);
  }
  return {
    registration: parseRegistration(rows[0].registration),
    event: parseEvent(rows[0].event),
    organizationName: rows[0].organizationName,
    answers: answerRows.map(({ answer }) => ({
      label: answer.fieldLabelSnapshot,
      type: formFieldTypeSchema.parse(answer.fieldTypeSnapshot),
      valueText: answer.valueText,
      valueBool: answer.valueBool,
      optionLabels: optionsByAnswer.get(answer.id) ?? []
    }))
  };
}

export function canWithdrawRegistration(
  detail: Pick<OwnedRegistrationDetail, 'registration' | 'event'>,
  now = new Date()
): boolean {
  return detail.registration.status !== 'cancelled' && now < detail.event.startsAt;
}

/** Withdraws an active registration and fills the resulting vacancy atomically. */
export async function withdrawRegistration(
  client: DatabaseClient,
  input: { registrationId: string; userId: string }
): Promise<{ registration: RegistrationSummary; promotedRegistrationId: string | null }> {
  return client.db.transaction(async (tx) => {
    const identityRows = await tx
      .select({ eventId: registrations.eventId })
      .from(registrations)
      .where(
        and(eq(registrations.id, input.registrationId), eq(registrations.userId, input.userId))
      )
      .limit(1);
    if (!identityRows[0]) throw new RegistrationError('not_found', 'registration not found');
    const eventRows = await tx
      .select()
      .from(events)
      .where(eq(events.id, identityRows[0].eventId))
      .limit(1)
      .for('update');
    if (!eventRows[0]) throw new RegistrationError('not_found', 'event not found');
    const event = parseEvent(eventRows[0]);

    const registrationRows = await tx
      .select()
      .from(registrations)
      .where(
        and(eq(registrations.id, input.registrationId), eq(registrations.userId, input.userId))
      )
      .limit(1)
      .for('update');
    if (!registrationRows[0]) throw new RegistrationError('not_found', 'registration not found');
    const current = parseRegistration(registrationRows[0]);
    if (!canWithdrawRegistration({ registration: current, event })) {
      throw new RegistrationError('not_withdrawable', 'registration cannot be withdrawn');
    }

    const updatedRows = await tx
      .update(registrations)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(registrations.id, current.id))
      .returning();
    const withdrawn = parseRegistration(updatedRows[0]);
    await appendAudit(tx, {
      actorUserId: input.userId,
      eventId: current.eventId,
      action: 'registration.withdraw',
      targetType: 'registration',
      targetId: current.id,
      before: { status: current.status },
      after: { status: withdrawn.status },
      reason: 'participant withdrawal'
    });
    await cancelPaymentRequestsForRegistration(tx, current.id);
    await enqueueRoleSync(tx, current.eventId, current.id);

    let promotedRegistrationId: string | null = null;
    if (current.status === 'confirmed' && event.registrationMode === 'auto_confirm') {
      promotedRegistrationId = await promoteOldestWaitlisted(tx, {
        eventId: event.id,
        capacity: event.capacity,
        actorUserId: input.userId,
        reason: 'vacancy after participant withdrawal'
      });
    }
    return { registration: withdrawn, promotedRegistrationId };
  });
}

function parseRegistration(row: typeof registrations.$inferSelect): RegistrationSummary {
  return { ...row, status: registrationStatusSchema.parse(row.status) };
}

function parseEvent(row: typeof events.$inferSelect): EventSummary {
  return {
    ...row,
    visibility: eventVisibilitySchema.parse(row.visibility),
    discordPolicy: discordPolicySchema.parse(row.discordPolicy),
    venueReveal: venueRevealSchema.parse(row.venueReveal),
    registrationMode: registrationModeSchema.parse(row.registrationMode)
  };
}
