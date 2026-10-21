import { organizationDisclosure } from '../orgs/disclosure';
import { configureEventPayment } from '../payments/event-payment';
import { defaultTuning, type Tuning } from '$lib/server/config';
import { systemClock, type Clock } from '$lib/server/clock';
import { write, read } from '$lib/server/db/client';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import {
  events,
  eventDiscordIntegrations,
  eventFormFields,
  eventFormFieldOptions,
  registrations
} from '$lib/server/db/schema';
import { enqueueExistingPanelRefresh } from '$lib/server/domain/discord/outbox';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { parseWallClock } from '$lib/server/time';
import {
  discordPolicySchema,
  eventVisibilitySchema,
  registrationModeSchema,
  venueRevealSchema
} from '$lib/shared/event';
import { translate } from '$lib/i18n';
import { EventError } from './errors';
import { generateEventSlug } from './slug';
import { canTransitionEvent, toggledVisibility, type EventTransition } from './transitions';
import type {
  CreateEventInput,
  EventAccess,
  EventMutationInput,
  EventSummary,
  UpdateEventSettingsInput
} from './types';

const slugAttempts = 4;

type SlugFactory = (startsAt: Date, timeZone: string) => string;

/** Creates a draft event and its audit record atomically. */
export async function createEvent(
  client: DatabaseClient,
  input: CreateEventInput,
  slugFactory: SlugFactory = generateEventSlug,
  clock: Clock = systemClock,
  tuning: Tuning = defaultTuning,
  roundingUnits: number[] = [1, 10, 100]
): Promise<EventSummary> {
  const title = validateTitle(input.title);
  const startsAt = parseInputTime(input.startsAt, input.timeZone, 'start time');
  const capacity = validateCapacity(input.capacity ?? null);
  const registrationMode = parseRegistrationMode(input.registrationMode ?? 'auto_confirm');
  for (let attempt = 0; attempt < slugAttempts; attempt += 1) {
    const slug = slugFactory(startsAt, input.timeZone);
    try {
      return write(client, (tx) => {
        authorizeOrganizationRole(tx, input.organizationId, input.actorUserId, 'organizer');
        const source = input.copyFromEventId
          ? tx
              .select()
              .from(events)
              .where(
                and(
                  eq(events.id, input.copyFromEventId),
                  eq(events.organizationId, input.organizationId)
                )
              )
              .get()
          : undefined;
        if (input.copyFromEventId && !source)
          throw new EventError('validation', 'copy source must belong to this organization');
        const endsAt = new Date(
          startsAt.getTime() +
            (source
              ? source.endsAt.getTime() - source.startsAt.getTime()
              : tuning.OFFKAI_EVENT_DEFAULT_DURATION_MS)
        );
        const created = tx
          .insert(events)
          .values({
            createdAt: clock.now(),
            updatedAt: clock.now(),
            ...(source
              ? {
                  description: source.description,
                  venueName: source.venueName,
                  venueAddress: source.venueAddress,
                  venueReveal: source.venueReveal,
                  contact: source.contact,
                  cancellationPolicy: source.cancellationPolicy
                }
              : {}),
            panelTemplateJa: source?.panelTemplateJa || translate('ja', 'panel_template.default'),
            panelTemplateEn: source?.panelTemplateEn || translate('en', 'panel_template.default'),
            organizationId: input.organizationId,
            title,
            slug,
            startsAt,
            endsAt,
            capacity: input.capacity === undefined ? (source?.capacity ?? capacity) : capacity,
            visibility: 'draft',
            platformFeeBps: tuning.OFFKAI_PLATFORM_FEE_BPS,
            discordPolicy: source?.discordPolicy ?? 'not_used',
            registrationOpensAt: clock.now(),
            registrationClosesAt: startsAt,
            venueReveal: source?.venueReveal ?? 'public',
            registrationMode: input.registrationMode ?? source?.registrationMode ?? registrationMode
          })
          .returning()
          .all();
        configureEventPayment(tx, created[0], input, clock, tuning, roundingUnits);
        const event = loadEvent(tx, created[0].id);
        if (source) {
          const integration = tx
            .select()
            .from(eventDiscordIntegrations)
            .where(eq(eventDiscordIntegrations.eventId, source.id))
            .get();
          if (integration) {
            tx.insert(eventDiscordIntegrations)
              .values({
                guildId: integration.guildId,
                guildNameSnapshot: integration.guildNameSnapshot,
                inviteUrl: integration.inviteUrl,
                announcementChannelId: integration.announcementChannelId,
                staffChannelId: integration.staffChannelId,
                staffRoleId: integration.staffRoleId,
                notificationChannelId: integration.notificationChannelId,
                roleId: integration.roleId,
                paidRoleId: integration.paidRoleId,
                questionsChannelId: integration.questionsChannelId,
                eventId: event.id,
                createdAt: clock.now(),
                updatedAt: clock.now()
              })
              .run();
          }
          const fields = tx
            .select()
            .from(eventFormFields)
            .where(and(eq(eventFormFields.eventId, source.id), isNull(eventFormFields.archivedAt)))
            .all();
          for (const field of fields) {
            const copied = tx
              .insert(eventFormFields)
              .values({
                fieldKey: field.fieldKey,
                label: field.label,
                fieldType: field.fieldType,
                required: field.required,
                position: field.position,
                helpText: field.helpText,
                eventId: event.id,
                createdAt: clock.now(),
                updatedAt: clock.now()
              })
              .returning()
              .get()!;
            const options = tx
              .select()
              .from(eventFormFieldOptions)
              .where(
                and(
                  eq(eventFormFieldOptions.fieldId, field.id),
                  isNull(eventFormFieldOptions.archivedAt)
                )
              )
              .all();
            for (const option of options) {
              tx.insert(eventFormFieldOptions)
                .values({
                  fieldId: copied.id,
                  optionKey: option.optionKey,
                  label: option.label,
                  position: option.position,
                  createdAt: clock.now(),
                  updatedAt: clock.now()
                })
                .run();
            }
          }
        }
        appendAudit(
          tx,
          {
            actorUserId: input.actorUserId,
            eventId: event.id,
            action: 'event.create',
            targetType: 'event',
            targetId: event.id,
            after: {
              title: event.title,
              slug: event.slug,
              visibility: event.visibility,
              paymentRequirement: event.paymentRequirement,
              platformFeeBps: event.platformFeeBps,
              amountToCollectMinor: event.amountToCollectMinor.toString(),
              copyFromEventId: input.copyFromEventId ?? null
            }
          },
          clock
        );
        return event;
      });
    } catch (cause) {
      if (!isEventSlugCollision(cause)) throw cause;
    }
  }
  throw new EventError('slug_collision', 'could not generate a unique event slug');
}

/** Lists the active workspace events visible to an organization member. */
export async function listEventsForOrganization(
  client: DatabaseClient,
  actorUserId: string,
  organizationId: string
): Promise<EventSummary[]> {
  return read(client, (tx) => {
    authorizeOrganizationRole(tx, organizationId, actorUserId, 'viewer', true);
    const rows = tx
      .select()
      .from(events)
      .where(and(eq(events.organizationId, organizationId), isNull(events.archivedAt)))
      .orderBy(asc(events.startsAt), asc(events.createdAt))
      .all();
    return rows.map(parseEvent);
  });
}

/** Loads an event together with the actor's active organization role. */
export async function getEventAccess(
  client: DatabaseClient,
  actorUserId: string,
  eventId: string
): Promise<EventAccess> {
  return read(client, (tx) => {
    const event = loadEvent(tx, eventId);
    const organization = authorizeOrganizationRole(
      tx,
      event.organizationId,
      actorUserId,
      'viewer',
      true
    );
    return {
      event,
      organizationSlug: organization.slug,
      actorRole: organization.role,
      organizationSuspendedAt: organization.suspendedAt
    };
  });
}

/** Updates every organizer-editable event setting without changing lifecycle state or slug. */
export async function updateSettings(
  client: DatabaseClient,
  input: UpdateEventSettingsInput,
  clock: Clock = systemClock,
  tuning: Tuning = defaultTuning,
  roundingUnits: number[] = [1, 10, 100]
): Promise<EventSummary> {
  const values = validateSettings(input);
  return write(client, (tx) => {
    const current = loadEvent(tx, input.eventId);
    authorizeOrganizationRole(tx, current.organizationId, input.actorUserId, 'organizer');
    if (current.archivedAt) {
      throw new EventError('illegal_transition', 'archived events cannot be changed');
    }
    if (values.capacity !== null) {
      const occupied = tx
        .select({ n: count() })
        .from(registrations)
        .where(
          and(
            eq(registrations.eventId, current.id),
            inArray(registrations.status, ['held', 'confirmed'])
          )
        )
        .get()!.n;
      if (occupied > values.capacity)
        throw new EventError('validation', 'capacity cannot be smaller than reserved seats');
    }
    const full = tx.select().from(events).where(eq(events.id, current.id)).get()!;
    if (
      current.visibility !== 'draft' &&
      current.paymentRequirement === 'none' &&
      input.paymentRequirement &&
      input.paymentRequirement !== 'none' &&
      !organizationDisclosure(tx, current.organizationId)
    )
      throw new EventError('disclosure_required', 'organizer disclosure required');
    configureEventPayment(tx, full, input, clock, tuning, roundingUnits);
    const updatedRows = tx
      .update(events)
      .set({ ...values, updatedAt: clock.now() })
      .where(eq(events.id, current.id))
      .returning()
      .all();
    const updated = parseEvent(updatedRows[0]);
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: updated.id,
        action: 'event.settings_update',
        targetType: 'event',
        targetId: updated.id,
        before: settingsAuditSnapshot(current),
        after: settingsAuditSnapshot(updated)
      },
      clock
    );
    enqueueExistingPanelRefresh(tx, updated.id, clock);
    return updated;
  });
}

export async function publishEvent(
  client: DatabaseClient,
  input: EventMutationInput,
  clock: Clock = systemClock
): Promise<EventSummary> {
  return mutateLifecycle(
    client,
    input,
    'publish',
    'event.publish',
    () => ({
      visibility: 'public',
      updatedAt: clock.now()
    }),
    clock
  );
}

export async function toggleEventUnlisted(
  client: DatabaseClient,
  input: EventMutationInput,
  clock: Clock = systemClock
): Promise<EventSummary> {
  return mutateLifecycle(
    client,
    input,
    'toggle_unlisted',
    'event.unlist',
    (current) => ({
      visibility: toggledVisibility(current.visibility)!,
      updatedAt: clock.now()
    }),
    clock
  );
}

export async function cancelEvent(
  client: DatabaseClient,
  input: EventMutationInput,
  clock: Clock = systemClock
): Promise<EventSummary> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) throw new EventError('validation', 'a cancellation reason is required');
  return mutateLifecycle(
    client,
    { ...input, reason },
    'cancel',
    'event.cancel',
    () => ({
      cancelledAt: clock.now(),
      updatedAt: clock.now()
    }),
    clock
  );
}

export async function archiveEvent(
  client: DatabaseClient,
  input: EventMutationInput,
  clock: Clock = systemClock
): Promise<EventSummary> {
  return mutateLifecycle(
    client,
    input,
    'archive',
    'event.archive',
    () => ({
      archivedAt: clock.now(),
      updatedAt: clock.now()
    }),
    clock
  );
}

async function mutateLifecycle(
  client: DatabaseClient,
  input: EventMutationInput,
  transition: EventTransition,
  action: string,
  changes: (current: EventSummary) => Partial<typeof events.$inferInsert>,
  clock: Clock = systemClock
): Promise<EventSummary> {
  return write(client, (tx) => {
    const current = loadEvent(tx, input.eventId);
    authorizeOrganizationRole(tx, current.organizationId, input.actorUserId, 'organizer');
    if (transition === 'cancel' && current.cancelledAt) return current;
    if (
      !canTransitionEvent(
        {
          visibility: current.visibility,
          cancelled: current.cancelledAt !== null,
          archived: current.archivedAt !== null
        },
        transition
      )
    ) {
      throw new EventError(
        'illegal_transition',
        `event cannot apply lifecycle transition ${transition}`
      );
    }
    if (
      transition === 'publish' &&
      current.paymentRequirement !== 'none' &&
      !organizationDisclosure(tx, current.organizationId)
    )
      throw new EventError('disclosure_required', 'organizer disclosure required');
    const updatedRows = tx
      .update(events)
      .set(changes(current))
      .where(eq(events.id, current.id))
      .returning()
      .all();
    const updated = parseEvent(updatedRows[0]);
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: updated.id,
        action,
        targetType: 'event',
        targetId: updated.id,
        reason: input.reason?.trim(),
        before: lifecycleAuditSnapshot(current),
        after: lifecycleAuditSnapshot(updated)
      },
      clock
    );
    enqueueExistingPanelRefresh(tx, updated.id, clock);
    return updated;
  });
}

function loadEvent(tx: DatabaseTransaction, eventId: string): EventSummary {
  const query = tx.select().from(events).where(eq(events.id, eventId)).limit(1);
  const rows = query.all();
  if (!rows[0]) throw new EventError('not_found', 'event not found');
  return parseEvent(rows[0]);
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

function validateSettings(input: UpdateEventSettingsInput) {
  const startsAt = parseInputTime(input.startsAt, input.timeZone, 'start time');
  const endsAt = parseInputTime(input.endsAt, input.timeZone, 'end time');
  const registrationOpensAt = parseInputTime(
    input.registrationOpensAt,
    input.timeZone,
    'registration opening time'
  );
  const registrationClosesAt = parseInputTime(
    input.registrationClosesAt,
    input.timeZone,
    'registration closing time'
  );
  if (endsAt <= startsAt) throw new EventError('validation', 'end time must follow start time');
  if (registrationClosesAt < registrationOpensAt) {
    throw new EventError('validation', 'registration closing time must follow opening time');
  }
  return {
    title: validateTitle(input.title),
    description: input.description.trim(),
    startsAt,
    endsAt,
    capacity: validateCapacity(input.capacity),
    venueName: input.venueName.trim(),
    venueAddress: input.venueAddress.trim(),
    venueReveal: parseVenueReveal(input.venueReveal),
    contact: input.contact.trim(),
    cancellationPolicy: input.cancellationPolicy.trim(),
    registrationOpensAt,
    registrationClosesAt,
    registrationMode: parseRegistrationMode(input.registrationMode),
    ...(input.discordPolicy === undefined
      ? {}
      : { discordPolicy: parseDiscordPolicy(input.discordPolicy) })
  };
}

function validateTitle(raw: string): string {
  const title = raw.trim();
  if (!title || title.length > 200) {
    throw new EventError('validation', 'event title must be 1 to 200 characters');
  }
  return title;
}

function validateCapacity(capacity: number | null): number | null {
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    throw new EventError('validation', 'event capacity must be a positive integer');
  }
  return capacity;
}

function parseInputTime(value: string, zone: string, field: string): Date {
  try {
    const parsed = parseWallClock(value, zone);
    if (!Number.isFinite(parsed.getTime())) throw new Error('invalid date');
    return parsed;
  } catch (cause) {
    throw new EventError('validation', `${field} is invalid`, { cause });
  }
}

function parseRegistrationMode(value: unknown) {
  const parsed = registrationModeSchema.safeParse(value);
  if (!parsed.success) throw new EventError('validation', 'registration mode is invalid');
  return parsed.data;
}

function parseVenueReveal(value: unknown) {
  const parsed = venueRevealSchema.safeParse(value);
  if (!parsed.success) throw new EventError('validation', 'venue reveal setting is invalid');
  return parsed.data;
}

function parseDiscordPolicy(value: unknown) {
  const parsed = discordPolicySchema.safeParse(value);
  if (!parsed.success) throw new EventError('validation', 'Discord policy is invalid');
  return parsed.data;
}

function lifecycleAuditSnapshot(event: EventSummary) {
  return {
    visibility: event.visibility,
    cancelledAt: event.cancelledAt?.toISOString() ?? null,
    archivedAt: event.archivedAt?.toISOString() ?? null
  };
}

function settingsAuditSnapshot(event: EventSummary) {
  return {
    paymentRequirement: event.paymentRequirement,
    platformFeeBps: event.platformFeeBps,
    amountToCollectMinor: event.amountToCollectMinor.toString(),
    roundingUnit: event.roundingUnit,
    holdMinutes: event.holdMinutes,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    capacity: event.capacity,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    venueReveal: event.venueReveal,
    contact: event.contact,
    cancellationPolicy: event.cancellationPolicy,
    registrationOpensAt: event.registrationOpensAt.toISOString(),
    registrationClosesAt: event.registrationClosesAt.toISOString(),
    registrationMode: event.registrationMode,
    discordPolicy: event.discordPolicy
  };
}

function isEventSlugCollision(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const error = cause as {
    cause?: unknown;
    code?: unknown;
    message?: string;
  };
  return (
    (error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      error.message?.includes('events.organization_id, events.slug') === true) ||
    isEventSlugCollision(error.cause)
  );
}

export function listCopySources(
  client: DatabaseClient,
  actorUserId: string,
  organizationId: string
) {
  return read(client, (tx) => {
    authorizeOrganizationRole(tx, organizationId, actorUserId, 'organizer');
    return tx
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(eq(events.organizationId, organizationId))
      .orderBy(asc(events.title), asc(events.id))
      .all();
  });
}
