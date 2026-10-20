import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import { events } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { parseWallClock } from '$lib/server/time';
import {
  discordPolicySchema,
  eventVisibilitySchema,
  registrationModeSchema,
  venueRevealSchema
} from '$lib/shared/event';
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
  slugFactory: SlugFactory = generateEventSlug
): Promise<EventSummary> {
  const title = validateTitle(input.title);
  const startsAt = parseInputTime(input.startsAt, input.timeZone, 'start time');
  const capacity = validateCapacity(input.capacity ?? null);
  const registrationMode = parseRegistrationMode(input.registrationMode ?? 'auto_confirm');

  for (let attempt = 0; attempt < slugAttempts; attempt += 1) {
    const slug = slugFactory(startsAt, input.timeZone);
    try {
      return await client.db.transaction(async (tx) => {
        await authorizeOrganizationRole(tx, input.organizationId, input.actorUserId, 'organizer');
        const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1_000);
        const created = await tx
          .insert(events)
          .values({
            organizationId: input.organizationId,
            title,
            slug,
            startsAt,
            endsAt,
            capacity,
            visibility: 'draft',
            discordPolicy: 'not_used',
            registrationOpensAt: new Date(),
            registrationClosesAt: startsAt,
            venueReveal: 'public',
            registrationMode
          })
          .returning();
        const event = parseEvent(created[0]);
        await appendAudit(tx, {
          actorUserId: input.actorUserId,
          eventId: event.id,
          action: 'event.create',
          targetType: 'event',
          targetId: event.id,
          after: { title: event.title, slug: event.slug, visibility: event.visibility }
        });
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
  return client.db.transaction(async (tx) => {
    await authorizeOrganizationRole(tx, organizationId, actorUserId, 'viewer', false, true);
    const rows = await tx
      .select()
      .from(events)
      .where(and(eq(events.organizationId, organizationId), isNull(events.archivedAt)))
      .orderBy(asc(events.startsAt), asc(events.createdAt));
    return rows.map(parseEvent);
  });
}

/** Loads an event together with the actor's active organization role. */
export async function getEventAccess(
  client: DatabaseClient,
  actorUserId: string,
  eventId: string
): Promise<EventAccess> {
  return client.db.transaction(async (tx) => {
    const event = await loadEvent(tx, eventId);
    const organization = await authorizeOrganizationRole(
      tx,
      event.organizationId,
      actorUserId,
      'viewer',
      false,
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
  input: UpdateEventSettingsInput
): Promise<EventSummary> {
  const values = validateSettings(input);
  return client.db.transaction(async (tx) => {
    const current = await loadEvent(tx, input.eventId, true);
    await authorizeOrganizationRole(tx, current.organizationId, input.actorUserId, 'organizer');
    if (current.archivedAt) {
      throw new EventError('illegal_transition', 'archived events cannot be changed');
    }
    const updatedRows = await tx
      .update(events)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(events.id, current.id))
      .returning();
    const updated = parseEvent(updatedRows[0]);
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: updated.id,
      action: 'event.settings_update',
      targetType: 'event',
      targetId: updated.id,
      before: settingsAuditSnapshot(current),
      after: settingsAuditSnapshot(updated)
    });
    return updated;
  });
}

export async function publishEvent(
  client: DatabaseClient,
  input: EventMutationInput
): Promise<EventSummary> {
  return mutateLifecycle(client, input, 'publish', 'event.publish', () => ({
    visibility: 'public',
    updatedAt: new Date()
  }));
}

export async function toggleEventUnlisted(
  client: DatabaseClient,
  input: EventMutationInput
): Promise<EventSummary> {
  return mutateLifecycle(client, input, 'toggle_unlisted', 'event.unlist', (current) => ({
    visibility: toggledVisibility(current.visibility)!,
    updatedAt: new Date()
  }));
}

export async function cancelEvent(
  client: DatabaseClient,
  input: EventMutationInput
): Promise<EventSummary> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) throw new EventError('validation', 'a cancellation reason is required');
  return mutateLifecycle(client, { ...input, reason }, 'cancel', 'event.cancel', () => ({
    cancelledAt: new Date(),
    updatedAt: new Date()
  }));
}

export async function archiveEvent(
  client: DatabaseClient,
  input: EventMutationInput
): Promise<EventSummary> {
  return mutateLifecycle(client, input, 'archive', 'event.archive', () => ({
    archivedAt: new Date(),
    updatedAt: new Date()
  }));
}

async function mutateLifecycle(
  client: DatabaseClient,
  input: EventMutationInput,
  transition: EventTransition,
  action: string,
  changes: (current: EventSummary) => Partial<typeof events.$inferInsert>
): Promise<EventSummary> {
  return client.db.transaction(async (tx) => {
    const current = await loadEvent(tx, input.eventId, true);
    await authorizeOrganizationRole(tx, current.organizationId, input.actorUserId, 'organizer');
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
    const updatedRows = await tx
      .update(events)
      .set(changes(current))
      .where(eq(events.id, current.id))
      .returning();
    const updated = parseEvent(updatedRows[0]);
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: updated.id,
      action,
      targetType: 'event',
      targetId: updated.id,
      reason: input.reason?.trim(),
      before: lifecycleAuditSnapshot(current),
      after: lifecycleAuditSnapshot(updated)
    });
    return updated;
  });
}

async function loadEvent(
  tx: DatabaseTransaction,
  eventId: string,
  lock = false
): Promise<EventSummary> {
  const query = tx.select().from(events).where(eq(events.id, eventId)).limit(1);
  const rows = lock ? await query.for('update') : await query;
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
  const error = cause as { cause?: unknown; code?: unknown; constraint_name?: unknown };
  return (
    (error.code === '23505' && error.constraint_name === 'events_organization_id_slug_key') ||
    isEventSlugCollision(error.cause)
  );
}
