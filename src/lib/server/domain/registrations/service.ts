import { and, count, eq, ne } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  events,
  externalAccounts,
  organizations,
  registrationFormAnswerOptions,
  registrationFormAnswers,
  registrations,
  users
} from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { enqueueRoleSync } from '$lib/server/domain/discord';
import { loadActiveFormFields, type RegistrationFormField } from '$lib/server/domain/events';
import { ensurePaymentRequestsForRegistration } from '$lib/server/domain/payments';
import { registrationModeSchema } from '$lib/shared/event';
import { registrationStatusSchema, type RegistrationStatus } from '$lib/shared/registration';
import { RegistrationError } from './errors';
import { validateRegistrationAnswers, type RegistrationAnswerInput } from './runtime-schema';

export interface CreateRegistrationInput {
  organizationSlug: string;
  eventSlug: string;
  userId: string;
  displayName: string;
  answers: RegistrationAnswerInput[];
}

export interface RegistrationSummary {
  id: string;
  eventId: string;
  userId: string;
  status: RegistrationStatus;
  displayNameSnapshot: string;
  searchText: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listActiveRegistrationFields(
  client: DatabaseClient,
  eventId: string
): Promise<RegistrationFormField[]> {
  return client.db.transaction((tx) => loadActiveFormFields(tx, eventId));
}

/** Creates one registration, its answer snapshots, and its audit record atomically. */
export async function createRegistration(
  client: DatabaseClient,
  input: CreateRegistrationInput
): Promise<RegistrationSummary> {
  try {
    return await client.db.transaction(async (tx) => {
      const userRows = await tx
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
        .for('update');
      if (!userRows[0] || userRows[0].suspendedAt) {
        throw new RegistrationError('forbidden', 'user is suspended');
      }
      const event = await loadRegistrableEventForUpdate(
        tx,
        input.organizationSlug,
        input.eventSlug
      );
      const fields = await loadActiveFormFields(tx, event.id);
      try {
        validateRegistrationAnswers(fields, input.answers);
      } catch (cause) {
        throw new RegistrationError('validation', 'registration answers are invalid', { cause });
      }

      const active = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(
          and(
            eq(registrations.eventId, event.id),
            eq(registrations.userId, input.userId),
            ne(registrations.status, 'cancelled')
          )
        )
        .limit(1);
      if (active[0]) {
        throw new RegistrationError('duplicate', 'user already has an active registration');
      }

      let status: RegistrationStatus = 'applied';
      if (registrationModeSchema.parse(event.registrationMode) === 'auto_confirm') {
        const confirmedRows = await tx
          .select({ value: count(registrations.id) })
          .from(registrations)
          .where(and(eq(registrations.eventId, event.id), eq(registrations.status, 'confirmed')));
        const confirmedCount = confirmedRows[0]?.value ?? 0;
        status =
          event.capacity !== null && confirmedCount >= event.capacity ? 'waitlisted' : 'confirmed';
      }

      const account = await tx
        .select({ username: externalAccounts.username })
        .from(externalAccounts)
        .where(
          and(eq(externalAccounts.userId, input.userId), eq(externalAccounts.provider, 'discord'))
        )
        .limit(1);
      const displayName = input.displayName.trim();
      if (!displayName) {
        throw new RegistrationError('validation', 'display name is required');
      }
      const searchText = [displayName, account[0]?.username ?? ''].filter(Boolean).join(' ');
      const createdRows = await tx
        .insert(registrations)
        .values({
          eventId: event.id,
          userId: input.userId,
          status,
          displayNameSnapshot: displayName,
          searchText
        })
        .returning();
      const registration = parseRegistration(createdRows[0]);

      await saveAnswers(tx, registration.id, event.id, fields, input.answers);
      await appendAudit(tx, {
        actorUserId: input.userId,
        eventId: event.id,
        action: 'registration.create',
        targetType: 'registration',
        targetId: registration.id,
        after: { status: registration.status }
      });
      if (registration.status === 'confirmed') {
        await ensurePaymentRequestsForRegistration(tx, event.id, registration.id);
        await enqueueRoleSync(tx, event.id, registration.id);
      }
      return registration;
    });
  } catch (cause) {
    if (cause instanceof RegistrationError) throw cause;
    if (isActiveRegistrationConflict(cause)) {
      throw new RegistrationError('duplicate', 'user already has an active registration', {
        cause
      });
    }
    throw cause;
  }
}

async function loadRegistrableEventForUpdate(
  tx: DatabaseTransaction,
  organizationSlug: string,
  eventSlug: string
) {
  const rows = await tx
    .select({ event: events, organizationSuspendedAt: organizations.suspendedAt })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(and(eq(organizations.slug, organizationSlug), eq(events.slug, eventSlug)))
    .limit(1)
    .for('update');
  const row = rows[0];
  if (
    !row ||
    row.organizationSuspendedAt ||
    row.event.archivedAt ||
    row.event.visibility === 'draft'
  ) {
    throw new RegistrationError('not_found', 'public event not found');
  }
  const now = new Date();
  if (
    row.event.cancelledAt ||
    now < row.event.registrationOpensAt ||
    now > row.event.registrationClosesAt
  ) {
    throw new RegistrationError('not_registrable', 'event is not accepting registrations');
  }
  return row.event;
}

async function saveAnswers(
  tx: DatabaseTransaction,
  registrationId: string,
  eventId: string,
  fields: readonly RegistrationFormField[],
  answers: readonly RegistrationAnswerInput[]
): Promise<void> {
  const answersByKey = new Map(answers.map((answer) => [answer.fieldKey, answer]));
  for (const field of fields) {
    const answer = answersByKey.get(field.key)!;
    const inserted = await tx
      .insert(registrationFormAnswers)
      .values({
        eventId,
        registrationId,
        fieldId: field.id,
        fieldKeySnapshot: field.key,
        fieldLabelSnapshot: field.label,
        fieldTypeSnapshot: field.type,
        valueText: answer.valueText,
        valueBool: answer.valueBool
      })
      .returning({ id: registrationFormAnswers.id });
    if (answer.optionIds.length === 0) continue;
    const optionById = new Map(field.options.map((option) => [option.id, option]));
    await tx.insert(registrationFormAnswerOptions).values(
      answer.optionIds.map((optionId) => {
        const option = optionById.get(optionId)!;
        return {
          answerId: inserted[0].id,
          fieldId: field.id,
          optionId: option.id,
          optionKeySnapshot: option.key,
          optionLabelSnapshot: option.label
        };
      })
    );
  }
}

function parseRegistration(row: typeof registrations.$inferSelect): RegistrationSummary {
  return { ...row, status: registrationStatusSchema.parse(row.status) };
}

function isActiveRegistrationConflict(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const error = cause as { cause?: unknown; code?: unknown; constraint_name?: unknown };
  return (
    (error.code === '23505' &&
      error.constraint_name === 'registrations_one_active_per_user_event') ||
    isActiveRegistrationConflict(error.cause)
  );
}
