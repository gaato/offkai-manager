import { and, count, eq, isNull, ne } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { events, organizations, registrations } from '$lib/server/db/schema';
import type { EventSummary } from '$lib/server/domain/events';
import {
  discordPolicySchema,
  eventVisibilitySchema,
  registrationModeSchema,
  venueRevealSchema
} from '$lib/shared/event';
import { RegistrationError } from './errors';
import type { PublicEvent, PublicVenue, RegistrationAvailability } from './types';

export async function getPublicEventBySlug(
  client: DatabaseClient,
  organizationSlug: string,
  eventSlug: string
): Promise<PublicEvent> {
  const rows = await client.db
    .select({
      event: events,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      confirmedCount: count(registrations.id)
    })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .leftJoin(
      registrations,
      and(eq(registrations.eventId, events.id), eq(registrations.status, 'confirmed'))
    )
    .where(
      and(
        eq(organizations.slug, organizationSlug),
        eq(events.slug, eventSlug),
        isNull(organizations.suspendedAt),
        isNull(events.archivedAt),
        ne(events.visibility, 'draft')
      )
    )
    .groupBy(events.id, organizations.id)
    .limit(1);
  if (!rows[0]) throw new RegistrationError('not_found', 'public event not found');
  return {
    event: parseEvent(rows[0].event),
    organizationName: rows[0].organizationName,
    organizationSlug: rows[0].organizationSlug,
    confirmedCount: rows[0].confirmedCount
  };
}

export function registrationAvailability(
  event: EventSummary,
  confirmedCount: number,
  now = new Date()
): RegistrationAvailability {
  if (event.cancelledAt) return { state: 'cancelled', canRegister: false };
  if (now < event.registrationOpensAt) {
    return { state: 'before_open', canRegister: false, opensAt: event.registrationOpensAt };
  }
  if (now > event.registrationClosesAt) return { state: 'closed', canRegister: false };
  if (
    event.registrationMode === 'auto_confirm' &&
    event.capacity !== null &&
    confirmedCount >= event.capacity
  ) {
    return { state: 'waitlist', canRegister: true };
  }
  return { state: 'open', canRegister: true };
}

export function publicVenue(event: EventSummary, confirmedViewer: boolean): PublicVenue {
  if (event.venueReveal === 'confirmed' && !confirmedViewer) {
    return {
      name: event.venueName,
      address: '',
      revealAfterConfirmation: true
    };
  }
  return {
    name: event.venueName,
    address: event.venueAddress,
    revealAfterConfirmation: false
  };
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
