import { attendanceState } from './core';
import { defaultTuning, type Tuning } from '$lib/server/config';
import { escapeLikePattern, ilike } from '$lib/server/db/search';
import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import {
  auditLogs,
  eventFormFields,
  events,
  externalAccounts,
  registrationFormAnswerOptions,
  registrationFormAnswers,
  registrations
} from '$lib/server/db/schema';
import { decideRegistration, applyRegistrationEffects } from './lifecycle';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import {
  cancelPaymentRequestsForRegistration,
  ensurePaymentRequestsForRegistration
} from '$lib/server/domain/payments';
import { formFieldTypeSchema, type FormFieldType } from '$lib/shared/registration-form';
import {
  registrationStatuses,
  registrationStatusSchema,
  type RegistrationStatus
} from '$lib/shared/registration';
import { RegistrationError } from './errors';
import { promoteOldestWaitlisted } from './promotion';
import type { RegistrationSummary } from './service';

export type ParticipantStatusFilter = RegistrationStatus | 'all';

export interface ParticipantListRow {
  id: string;
  displayName: string;
  username: string;
  status: RegistrationStatus;
  registeredAt: Date;
  unreachable: boolean;
}

export interface ParticipantList {
  rows: ParticipantListRow[];
  counts: Record<ParticipantStatusFilter, number>;
  capped: boolean;
}

/** Lists event registrations for staff while preserving the legacy case-insensitive substring search. */
export async function listParticipants(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    eventId: string;
    status: ParticipantStatusFilter;
    query: string;
  },
  tuning: Tuning = defaultTuning
): Promise<ParticipantList> {
  return read(client, (tx) => {
    const eventRows = tx
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1)
      .all();
    if (!eventRows[0]) throw new RegistrationError('not_found', 'event not found');
    authorizeOrganizationRole(tx, eventRows[0].organizationId, input.actorUserId, 'staff', true);
    const countRows = tx
      .select({ status: registrations.status, value: count(registrations.id) })
      .from(registrations)
      .where(eq(registrations.eventId, input.eventId))
      .groupBy(registrations.status)
      .all();
    const counts: Record<ParticipantStatusFilter, number> = {
      all: 0,
      applied: 0,
      held: 0,
      confirmed: 0,
      waitlisted: 0,
      cancelled: 0
    };
    for (const row of countRows) {
      const status = registrationStatusSchema.parse(row.status);
      counts[status] = row.value;
      counts.all += row.value;
    }
    const conditions: SQL[] = [eq(registrations.eventId, input.eventId)];
    if (input.status !== 'all') conditions.push(eq(registrations.status, input.status));
    const query = input.query.trim();
    if (query) conditions.push(ilike(registrations.searchText, `%${escapeLikePattern(query)}%`));
    const rows = tx
      .select({
        id: registrations.id,
        displayName: registrations.displayNameSnapshot,
        username: externalAccounts.username,
        status: registrations.status,
        unreachable: sql<number>`exists(select 1 from notification_deliveries d where d.registration_id = ${registrations.id} and d.result like 'failed:%' and not exists(select 1 from notification_deliveries success where success.registration_id = d.registration_id and success.kind = d.kind and success.result = 'sent'))`,
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
      .where(and(...conditions))
      .orderBy(asc(registrations.createdAt), asc(registrations.id))
      .limit(tuning.OFFKAI_PARTICIPANT_LIST_LIMIT + 1)
      .all();
    return {
      rows: rows.slice(0, tuning.OFFKAI_PARTICIPANT_LIST_LIMIT).map((row) => ({
        ...row,
        unreachable: Boolean(row.unreachable),
        username: row.username ?? '',
        status: registrationStatusSchema.parse(row.status)
      })),
      counts,
      capped: rows.length > tuning.OFFKAI_PARTICIPANT_LIST_LIMIT
    };
  });
}

export function participantStatusFilter(raw: string | null): ParticipantStatusFilter {
  if (!raw || raw === 'all') return 'all';
  const parsed = registrationStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'all';
}

export const participantStatusFilters = ['all', ...registrationStatuses] as const;

export interface AdminRegistrationAnswer {
  label: string;
  type: FormFieldType;
  valueText: string;
  valueBool: boolean | null;
  optionLabels: string[];
}

export interface RegistrationAuditRow {
  id: string;
  action: string;
  actorName: string;
  beforeStatus: RegistrationStatus | null;
  afterStatus: RegistrationStatus | null;
  createdAt: Date;
}

export interface AdminRegistrationDetail {
  registration: RegistrationSummary;
  event: {
    id: string;
    title: string;
  };
  username: string;
  answers: AdminRegistrationAnswer[];
  audits: RegistrationAuditRow[];
  canMutate: boolean;
}

/** Loads a registration's immutable answer snapshots and related audit history for staff. */
export async function getAdminRegistrationDetail(
  client: DatabaseClient,
  actorUserId: string,
  registrationId: string
): Promise<AdminRegistrationDetail> {
  return read(client, (tx) => {
    const rows = tx
      .select({ registration: registrations, event: events, username: externalAccounts.username })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .leftJoin(
        externalAccounts,
        and(
          eq(externalAccounts.userId, registrations.userId),
          eq(externalAccounts.provider, 'discord')
        )
      )
      .where(eq(registrations.id, registrationId))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row) throw new RegistrationError('not_found', 'registration not found');
    const access = authorizeOrganizationRole(
      tx,
      row.event.organizationId,
      actorUserId,
      'staff',
      true
    );
    const answerRows = tx
      .select({ answer: registrationFormAnswers, position: eventFormFields.position })
      .from(registrationFormAnswers)
      .innerJoin(eventFormFields, eq(eventFormFields.id, registrationFormAnswers.fieldId))
      .where(eq(registrationFormAnswers.registrationId, registrationId))
      .orderBy(asc(eventFormFields.position), asc(registrationFormAnswers.id))
      .all();
    const answerIds = answerRows.map(({ answer }) => answer.id);
    const optionRows =
      answerIds.length === 0
        ? []
        : tx
            .select()
            .from(registrationFormAnswerOptions)
            .where(inArray(registrationFormAnswerOptions.answerId, answerIds))
            .all();
    const optionsByAnswer = new Map<string, string[]>();
    for (const option of optionRows) {
      const labels = optionsByAnswer.get(option.answerId) ?? [];
      labels.push(option.optionLabelSnapshot);
      optionsByAnswer.set(option.answerId, labels);
    }
    const relatedAudits = tx
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, 'registration'), eq(auditLogs.targetId, registrationId)))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .all();
    const actorIds = relatedAudits
      .map(({ actorUserId }) => actorUserId)
      .filter((id): id is string => id !== null);
    const actorRows =
      actorIds.length === 0
        ? []
        : tx
            .select({
              userId: externalAccounts.userId,
              displayName: externalAccounts.displayName,
              username: externalAccounts.username
            })
            .from(externalAccounts)
            .where(
              and(
                eq(externalAccounts.provider, 'discord'),
                inArray(externalAccounts.userId, actorIds)
              )
            )
            .all();
    const actorNames = new Map(
      actorRows.map(({ userId, displayName, username }) => [userId, displayName || username])
    );
    return {
      registration: parseRegistration(row.registration),
      event: { id: row.event.id, title: row.event.title },
      username: row.username ?? '',
      answers: answerRows.map(({ answer }) => ({
        label: answer.fieldLabelSnapshot,
        type: formFieldTypeSchema.parse(answer.fieldTypeSnapshot),
        valueText: answer.valueText,
        valueBool: answer.valueBool,
        optionLabels: optionsByAnswer.get(answer.id) ?? []
      })),
      audits: relatedAudits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        actorName: audit.actorUserId ? (actorNames.get(audit.actorUserId) ?? '') : '',
        beforeStatus: auditStatus(audit.beforeJson),
        afterStatus: auditStatus(audit.afterJson),
        createdAt: audit.createdAt
      })),
      canMutate: !access.suspendedAt && access.capabilities.canOperateParticipants
    };
  });
}

export async function changeRegistrationStatus(
  client: DatabaseClient,
  input: {
    actorUserId: string;
    registrationId: string;
    status: Extract<RegistrationStatus, 'confirmed' | 'waitlisted' | 'cancelled'>;
  },
  clock: Clock = systemClock
): Promise<RegistrationSummary> {
  return write(client, (tx) => {
    const identityRows = tx
      .select({ eventId: registrations.eventId })
      .from(registrations)
      .where(eq(registrations.id, input.registrationId))
      .limit(1)
      .all();
    if (!identityRows[0]) throw new RegistrationError('not_found', 'registration not found');
    const eventRows = tx
      .select()
      .from(events)
      .where(eq(events.id, identityRows[0].eventId))
      .limit(1)
      .all();
    const event = eventRows[0];
    if (!event) throw new RegistrationError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, input.actorUserId, 'organizer');
    const registrationRows = tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, input.registrationId))
      .limit(1)
      .all();
    const current = registrationRows[0];
    if (!current || current.eventId !== event.id) {
      throw new RegistrationError('not_found', 'registration not found');
    }
    const currentStatus = registrationStatusSchema.parse(current.status);
    const decision = decideRegistration(
      tx,
      event,
      attendanceState(current),
      { type: 'setStatus', status: input.status },
      clock
    );
    const updatedRows = tx
      .update(registrations)
      .set({
        status: decision.next.kind,
        holdExpiresAt: decision.next.kind === 'held' ? decision.next.holdExpiresAt : null,
        updatedAt: clock.now()
      })
      .where(and(eq(registrations.id, current.id), eq(registrations.status, currentStatus)))
      .returning()
      .all();
    if (!updatedRows[0]) {
      throw new RegistrationError('illegal_transition', 'registration changed concurrently');
    }
    const updated = parseRegistration(updatedRows[0]);
    applyRegistrationEffects(
      tx,
      decision,
      {
        actorUserId: input.actorUserId,
        eventId: event.id,
        action: registrationAction(input.status),
        targetType: 'registration',
        targetId: current.id,
        before: { status: currentStatus },
        after: { status: input.status },
        reason: 'organizer action'
      },
      clock
    );
    if (input.status === 'confirmed') {
      ensurePaymentRequestsForRegistration(tx, event.id, current.id, clock);
    } else if (input.status === 'cancelled') {
      cancelPaymentRequestsForRegistration(tx, current.id, clock);
    }
    if (
      input.status === 'cancelled' &&
      ['confirmed', 'held'].includes(currentStatus) &&
      event.registrationMode === 'auto_confirm'
    ) {
      promoteOldestWaitlisted(
        tx,
        {
          eventId: event.id,
          capacity: event.capacity,
          actorUserId: input.actorUserId,
          reason: 'vacancy after organizer cancellation'
        },
        clock
      );
    }
    return updated;
  });
}

function registrationAction(
  status: Extract<RegistrationStatus, 'confirmed' | 'waitlisted' | 'cancelled'>
): 'registration.confirm' | 'registration.waitlist' | 'registration.cancel' {
  if (status === 'confirmed') return 'registration.confirm';
  if (status === 'waitlisted') return 'registration.waitlist';
  return 'registration.cancel';
}

function parseRegistration(row: typeof registrations.$inferSelect): RegistrationSummary {
  return { ...row, status: registrationStatusSchema.parse(row.status) };
}

function auditStatus(value: unknown): RegistrationStatus | null {
  if (!value || typeof value !== 'object' || !('status' in value)) return null;
  const parsed = registrationStatusSchema.safeParse(value.status);
  return parsed.success ? parsed.data : null;
}
