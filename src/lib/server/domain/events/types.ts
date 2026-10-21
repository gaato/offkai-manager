import type {
  DiscordPolicy,
  EventVisibility,
  RegistrationMode,
  VenueReveal
} from '$lib/shared/event';
import type { OrganizationRole } from '$lib/shared/organization';

export interface EventSummary {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  visibility: EventVisibility;
  discordPolicy: DiscordPolicy;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  venueName: string;
  venueAddress: string;
  venueReveal: VenueReveal;
  contact: string;
  cancellationPolicy: string;
  registrationMode: RegistrationMode;
  panelTemplateJa: string;
  panelTemplateEn: string;
  panelTemplateReviewedAt: Date | null;
  cancelledAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventAccess {
  event: EventSummary;
  organizationSlug: string;
  actorRole: OrganizationRole;
  organizationSuspendedAt: Date | null;
}

export interface CreateEventInput {
  actorUserId: string;
  organizationId: string;
  title: string;
  startsAt: string;
  capacity?: number | null;
  registrationMode?: RegistrationMode;
  copyFromEventId?: string;
  timeZone: string;
}

export interface UpdateEventSettingsInput {
  actorUserId: string;
  eventId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  venueName: string;
  venueAddress: string;
  venueReveal: VenueReveal;
  contact: string;
  cancellationPolicy: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  registrationMode: RegistrationMode;
  discordPolicy?: DiscordPolicy;
  timeZone: string;
}

export interface EventMutationInput {
  actorUserId: string;
  eventId: string;
  reason?: string;
}
