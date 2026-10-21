import { and, asc, eq, inArray, isNull, ne, gte } from 'drizzle-orm';
import { read, write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import {
  events,
  eventDiscordIntegrations,
  registrations,
  checkinRecords,
  externalAccounts,
  paymentRequests,
  collectionPaymentMethods,
  registrationFormAnswers,
  registrationFormAnswerOptions
} from '$lib/server/db/schema';
import type { Clock } from '$lib/server/clock';
import { appendAudit } from '../audit';
import { confirmManualPaymentInTransaction } from '../payments/requests';
import { authorizeDoorStaff, type DoorActor } from './access';
import { CheckInError } from './service';

export function doorEvents(
  client: DatabaseClient,
  actor: DoorActor,
  now: Date,
  organizerOnly = false
) {
  return read(client, (tx) =>
    tx
      .select({ event: events })
      .from(events)
      .innerJoin(eventDiscordIntegrations, eq(events.id, eventDiscordIntegrations.eventId))
      .where(
        and(
          eq(eventDiscordIntegrations.guildId, actor.guildId),
          ne(events.visibility, 'draft'),
          isNull(events.cancelledAt),
          isNull(events.archivedAt),
          gte(events.endsAt, now)
        )
      )
      .orderBy(asc(events.startsAt), asc(events.id))
      .all()
      .flatMap(({ event }) => {
        try {
          authorizeDoorStaff(tx, event.id, actor, organizerOnly);
          return [event];
        } catch {
          return [];
        }
      })
  );
}
export function loadDoorRegistration(
  tx: DatabaseTransaction,
  registrationId: string,
  actor: DoorActor
) {
  const registration = tx
    .select()
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .get();
  if (!registration) throw new CheckInError('not_found', 'registration not found');
  const event = authorizeDoorStaff(tx, registration.eventId, actor);
  if (!['held', 'confirmed'].includes(registration.status))
    throw new CheckInError('not_confirmed', 'registration not admitted');
  const requests = tx
    .select()
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.registrationId, registration.id),
        ne(paymentRequests.status, 'cancelled')
      )
    )
    .all();
  const checkin = tx
    .select({ at: checkinRecords.createdAt, by: externalAccounts.displayName })
    .from(checkinRecords)
    .leftJoin(
      externalAccounts,
      and(
        eq(externalAccounts.userId, checkinRecords.actorUserId),
        eq(externalAccounts.provider, 'discord')
      )
    )
    .where(
      and(
        eq(checkinRecords.registrationId, registration.id),
        eq(checkinRecords.status, 'checked_in')
      )
    )
    .get();
  const answers = tx
    .select()
    .from(registrationFormAnswers)
    .where(eq(registrationFormAnswers.registrationId, registration.id))
    .all()
    .map((answer) => ({
      label: answer.fieldLabelSnapshot,
      value:
        answer.valueText ||
        (answer.valueBool === null ? '' : String(answer.valueBool)) ||
        tx
          .select()
          .from(registrationFormAnswerOptions)
          .where(eq(registrationFormAnswerOptions.answerId, answer.id))
          .all()
          .map((o) => o.optionLabelSnapshot)
          .join(', ')
    }));
  const unpaid = requests.filter((r) => ['pending', 'payment_pending'].includes(r.status));
  const methods =
    unpaid.length === 1
      ? tx
          .select()
          .from(collectionPaymentMethods)
          .where(
            and(
              eq(collectionPaymentMethods.collectionId, unpaid[0].collectionId),
              eq(collectionPaymentMethods.enabled, true),
              eq(collectionPaymentMethods.confirmation, 'manual'),
              inArray(collectionPaymentMethods.label, [
                'payments.default_method.cash.label',
                'payments.default_method.paypay.label'
              ])
            )
          )
          .all()
      : [];
  return { registration, event, requests, unpaid, methods, checkin, answers };
}
export function getDoorCard(client: DatabaseClient, registrationId: string, actor: DoorActor) {
  return read(client, (tx) => loadDoorRegistration(tx, registrationId, actor));
}
export type DoorCard = ReturnType<typeof getDoorCard>;
export function changeDoorCheckin(
  client: DatabaseClient,
  registrationId: string,
  actor: DoorActor,
  action: 'check' | 'undo' | 'cash' | 'paypay',
  clock: Clock
) {
  return write(client, (tx) => {
    const card = loadDoorRegistration(tx, registrationId, actor);
    if (action === 'undo') {
      const removed = tx
        .delete(checkinRecords)
        .where(
          and(
            eq(checkinRecords.registrationId, registrationId),
            eq(checkinRecords.status, 'checked_in')
          )
        )
        .returning()
        .all();
      if (removed.length)
        appendAudit(
          tx,
          {
            actorUserId: actor.actorUserId,
            eventId: card.event.id,
            action: 'checkin.undo',
            targetType: 'registration',
            targetId: registrationId,
            reason: 'staff undo'
          },
          clock
        );
    } else {
      if (action === 'cash' || action === 'paypay') {
        if (card.unpaid.length) {
          const method = card.methods.find(
            (m) => m.label === `payments.default_method.${action}.label`
          );
          if (!method || card.unpaid.length !== 1)
            throw new CheckInError('not_confirmed', 'manual method unavailable');
          // A stable request key also rejects a stale click switching cash to PayPay.
          confirmManualPaymentInTransaction(
            tx,
            {
              actorUserId: actor.actorUserId,
              paymentRequestId: card.unpaid[0].id,
              paymentMethodId: method.id,
              idempotencyKey: `door:${card.unpaid[0].id}`,
              externalReference: '',
              note: ''
            },
            clock,
            actor
          );
        }
      }
      const current = tx
        .select()
        .from(registrations)
        .where(eq(registrations.id, registrationId))
        .get()!;
      if (current.status !== 'confirmed')
        throw new CheckInError('not_confirmed', 'held seat requires settlement');
      if (!card.checkin) {
        const record = tx
          .insert(checkinRecords)
          .values({
            eventId: card.event.id,
            registrationId,
            actorUserId: actor.actorUserId,
            status: 'checked_in',
            method: 'search',
            createdAt: clock.now()
          })
          .returning()
          .get()!;
        appendAudit(
          tx,
          {
            actorUserId: actor.actorUserId,
            eventId: card.event.id,
            action: 'checkin.record',
            targetType: 'registration',
            targetId: registrationId,
            after: { checkinRecordId: record.id }
          },
          clock
        );
      }
    }
    return loadDoorRegistration(tx, registrationId, actor);
  });
}
export function doorPaymentState(
  card: Pick<DoorCard, 'requests' | 'unpaid'>
): import('$lib/shared/checkin').CheckInPaymentState {
  return card.unpaid.length
    ? 'unpaid'
    : card.requests.some((r) => r.status === 'paid' || r.status === 'refund_due')
      ? 'paid'
      : card.requests.some((r) => r.status === 'waived')
        ? 'waived'
        : 'none';
}
export function matchReception<T extends { number: number; displayName: string }>(
  rows: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  const number = /^\d+$/.test(q) ? Number(q) : null;
  return rows
    .filter((r) => !q || r.number === number || r.displayName.toLowerCase().includes(q))
    .sort(
      (a, b) => Number(b.number === number) - Number(a.number === number) || a.number - b.number
    )
    .slice(0, 25);
}
export function autocompleteDoor(
  client: DatabaseClient,
  actor: DoorActor,
  eventId: string,
  query: string
) {
  return read(client, (tx) => {
    authorizeDoorStaff(tx, eventId, actor);
    return matchReception(
      tx
        .select({
          id: registrations.id,
          number: registrations.number,
          displayName: registrations.displayNameSnapshot
        })
        .from(registrations)
        .where(
          and(
            eq(registrations.eventId, eventId),
            inArray(registrations.status, ['confirmed', 'held'])
          )
        )
        .all(),
      query
    ).map((row) => ({ ...row, card: loadDoorRegistration(tx, row.id, actor) }));
  });
}
