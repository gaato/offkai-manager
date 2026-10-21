import { attendanceState } from './core';
import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { and, eq, ne, sql } from 'drizzle-orm';
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
import { decideRegistration, applyRegistrationEffects } from './lifecycle';
import { loadActiveFormFields, type RegistrationFormField } from '$lib/server/domain/events';
import { ensurePaymentRequestsForRegistration } from '$lib/server/domain/payments';
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
  number: number;
  status: RegistrationStatus;
  displayNameSnapshot: string;
  searchText: string;
  holdExpiresAt?: Date | null;
  holdReleased?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function listActiveRegistrationFields(
  client: DatabaseClient,
  eventId: string
): Promise<RegistrationFormField[]> {
  return read(client, (tx) => loadActiveFormFields(tx, eventId));
}

/** Creates one registration, its answer snapshots, and its audit record atomically. */
export async function createRegistration(
  client: DatabaseClient,
  input: CreateRegistrationInput,
  clock: Clock = systemClock
): Promise<RegistrationSummary> {
  try {
    return write(client, (tx) => {
      const userRows = tx
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
        .all();
      if (!userRows[0] || userRows[0].suspendedAt) {
        throw new RegistrationError('forbidden', 'user is suspended');
      }
      const event = loadRegistrableEventForUpdate(tx, input.organizationSlug, input.eventSlug);
      const fields = loadActiveFormFields(tx, event.id);
      try {
        validateRegistrationAnswers(fields, input.answers);
      } catch (cause) {
        throw new RegistrationError('validation', 'registration answers are invalid', { cause });
      }
      const active = tx
        .select({ status: registrations.status, holdExpiresAt: registrations.holdExpiresAt })
        .from(registrations)
        .where(
          and(
            eq(registrations.eventId, event.id),
            eq(registrations.userId, input.userId),
            ne(registrations.status, 'cancelled')
          )
        )
        .limit(1)
        .all();
      const decision = decideRegistration(
        tx,
        event,
        active[0] ? attendanceState(active[0]) : { kind: 'none' },
        { type: 'join' },
        clock
      );
      const status = registrationStatusSchema.parse(decision.next.kind);
      const number = tx
        .select({ n: sql<number>`coalesce(max(${registrations.number}), 0) + 1` })
        .from(registrations)
        .where(eq(registrations.eventId, event.id))
        .get()!.n;
      const account = tx
        .select({ username: externalAccounts.username })
        .from(externalAccounts)
        .where(
          and(eq(externalAccounts.userId, input.userId), eq(externalAccounts.provider, 'discord'))
        )
        .limit(1)
        .all();
      const displayName = input.displayName.trim();
      if (!displayName) {
        throw new RegistrationError('validation', 'display name is required');
      }
      const searchText = [displayName, account[0]?.username ?? ''].filter(Boolean).join(' ');
      const createdRows = tx
        .insert(registrations)
        .values({
          createdAt: clock.now(),
          updatedAt: clock.now(),
          eventId: event.id,
          userId: input.userId,
          status,
          holdExpiresAt: decision.next.kind === 'held' ? decision.next.holdExpiresAt : null,
          number,
          displayNameSnapshot: displayName,
          searchText
        })
        .returning()
        .all();
      const registration = parseRegistration(createdRows[0]);
      saveAnswers(tx, registration.id, event.id, fields, input.answers, clock);
      applyRegistrationEffects(
        tx,
        decision,
        {
          actorUserId: input.userId,
          eventId: event.id,
          action: 'registration.create',
          targetType: 'registration',
          targetId: registration.id,
          after: { status: registration.status }
        },
        clock
      );
      if (['confirmed', 'held'].includes(registration.status)) {
        ensurePaymentRequestsForRegistration(tx, event.id, registration.id, clock);
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

function loadRegistrableEventForUpdate(
  tx: DatabaseTransaction,
  organizationSlug: string,
  eventSlug: string
) {
  const rows = tx
    .select({ event: events, organizationSuspendedAt: organizations.suspendedAt })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(and(eq(organizations.slug, organizationSlug), eq(events.slug, eventSlug)))
    .limit(1)
    .all();
  const row = rows[0];
  if (
    !row ||
    row.organizationSuspendedAt ||
    row.event.archivedAt ||
    row.event.visibility === 'draft'
  ) {
    throw new RegistrationError('not_found', 'public event not found');
  }
  return row.event;
}

export function saveAnswers(
  tx: DatabaseTransaction,
  registrationId: string,
  eventId: string,
  fields: readonly RegistrationFormField[],
  answers: readonly RegistrationAnswerInput[],
  clock: Clock = systemClock
): void {
  const answersByKey = new Map(answers.map((answer) => [answer.fieldKey, answer]));
  for (const field of fields) {
    const answer = answersByKey.get(field.key)!;
    const inserted = tx
      .insert(registrationFormAnswers)
      .values({
        createdAt: clock.now(),
        eventId,
        registrationId,
        fieldId: field.id,
        fieldKeySnapshot: field.key,
        fieldLabelSnapshot: field.label,
        fieldTypeSnapshot: field.type,
        valueText: answer.valueText,
        valueBool: answer.valueBool
      })
      .returning({ id: registrationFormAnswers.id })
      .all();
    if (answer.optionIds.length === 0) continue;
    const optionById = new Map(field.options.map((option) => [option.id, option]));
    tx.insert(registrationFormAnswerOptions)
      .values(
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
      )
      .run();
  }
}

function parseRegistration(row: typeof registrations.$inferSelect): RegistrationSummary {
  return { ...row, status: registrationStatusSchema.parse(row.status) };
}

function isActiveRegistrationConflict(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const error = cause as {
    cause?: unknown;
    code?: unknown;
    message?: string;
  };
  return (
    (error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      error.message?.includes('registrations.event_id, registrations.user_id') === true) ||
    isActiveRegistrationConflict(error.cause)
  );
}
