import { attendanceState } from './core';
import { and, eq, inArray } from 'drizzle-orm';
import { systemClock, type Clock } from '$lib/server/clock';
import { read, write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import {
  events,
  registrationFormAnswers,
  registrationFormAnswerOptions,
  registrations,
  users,
  organizations
} from '$lib/server/db/schema';
import { loadActiveFormFields } from '$lib/server/domain/events/forms';
import { decideRegistration, applyRegistrationEffects } from './lifecycle';
import { RegistrationError } from './errors';
import { saveAnswers } from './service';
import { validateRegistrationAnswers, type RegistrationAnswerInput } from './runtime-schema';

export function assertRegistrationActor(
  tx: DatabaseTransaction,
  userId: string,
  eventId: string
): void {
  const user = tx.select().from(users).where(eq(users.id, userId)).get();
  const event = tx
    .select({ suspendedAt: organizations.suspendedAt })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(eq(events.id, eventId))
    .get();
  if (!user || user.suspendedAt || !event || event.suspendedAt)
    throw new RegistrationError('forbidden', 'registration actor is unavailable');
}

export function loadOwnedAnswerData(
  client: DatabaseClient,
  registrationId: string,
  userId: string
): Record<string, unknown> {
  return read(client, (tx) => {
    const registration = tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.id, registrationId), eq(registrations.userId, userId)))
      .get();
    if (!registration) throw new RegistrationError('not_found', 'registration not found');
    const answers = tx
      .select()
      .from(registrationFormAnswers)
      .where(eq(registrationFormAnswers.registrationId, registrationId))
      .all();
    return Object.fromEntries(
      answers.map((answer) => {
        const options = tx
          .select()
          .from(registrationFormAnswerOptions)
          .where(eq(registrationFormAnswerOptions.answerId, answer.id))
          .all();
        return [
          answer.fieldKeySnapshot,
          answer.fieldTypeSnapshot === 'text' || answer.fieldTypeSnapshot === 'textarea'
            ? answer.valueText
            : answer.fieldTypeSnapshot === 'checkbox' || answer.fieldTypeSnapshot === 'consent'
              ? answer.valueBool
              : answer.fieldTypeSnapshot === 'select'
                ? (options[0]?.optionId ?? '')
                : options.map((option) => option.optionId)
        ];
      })
    );
  });
}

export function editRegistrationAnswers(
  client: DatabaseClient,
  input: {
    userId: string;
    registrationId: string;
    answers: RegistrationAnswerInput[];
  },
  clock: Clock = systemClock
): void {
  write(client, (tx) => {
    const current = tx
      .select()
      .from(registrations)
      .where(
        and(eq(registrations.id, input.registrationId), eq(registrations.userId, input.userId))
      )
      .get();
    if (!current) throw new RegistrationError('not_found', 'registration not found');
    assertRegistrationActor(tx, input.userId, current.eventId);
    const event = tx.select().from(events).where(eq(events.id, current.eventId)).get()!;
    const decision = decideRegistration(
      tx,
      event,
      attendanceState(current),
      { type: 'editAnswers' },
      clock
    );
    const fields = loadActiveFormFields(tx, event.id);
    try {
      validateRegistrationAnswers(fields, input.answers);
    } catch (cause) {
      throw new RegistrationError('validation', 'invalid answers', { cause });
    }
    // Replace active answers atomically, retaining archived-field snapshots as historical evidence.
    if (fields.length)
      tx.delete(registrationFormAnswers)
        .where(
          and(
            eq(registrationFormAnswers.registrationId, current.id),
            inArray(
              registrationFormAnswers.fieldId,
              fields.map((field) => field.id)
            )
          )
        )
        .run();
    saveAnswers(tx, current.id, event.id, fields, input.answers, clock);
    tx.update(registrations)
      .set({ updatedAt: clock.now() })
      .where(eq(registrations.id, current.id))
      .run();
    applyRegistrationEffects(
      tx,
      decision,
      {
        actorUserId: input.userId,
        eventId: event.id,
        action: 'registration.edit_answers',
        targetType: 'registration',
        targetId: current.id,
        before: { status: current.status },
        after: { status: current.status }
      },
      clock
    );
  });
}
