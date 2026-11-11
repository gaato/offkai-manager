import type { EventPaymentInput } from '../payments/event-payment';
import type {
  DiscordPolicy,
  EventVisibility,
  RegistrationMode,
  VenueReveal
} from '$lib/shared/event';
import type { OrganizationRole } from '$lib/shared/organization';
import type { OverdueRelease } from '$lib/shared/overdue-policy';

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
  paymentRequirement: string;
  paymentOpensAt?: Date | null;
  paymentDueAt?: Date | null;
  additionalOpensAt?: Date | null;
  /** Raw columns; read them through `overduePolicyFromColumns`. */
  overdueRelease: string;
  overdueGraceDays: number;
  platformFeeBps: number;
  amountToCollectMinor: bigint;
  roundingUnit: number;
  holdMinutes: number;
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

export interface CreateEventInput extends EventPaymentInput {
  actorUserId: string;
  organizationId: string;
  title: string;
  startsAt: string;
  paymentOpensAt?: string;
  paymentDueAt?: string;
  additionalOpensAt?: string;
  overdueRelease?: OverdueRelease;
  overdueGraceDays?: number;
  capacity?: number | null;
  registrationMode?: RegistrationMode;
  copyFromEventId?: string;
  timeZone: string;
}

export interface UpdateEventSettingsInput extends EventPaymentInput {
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
  paymentOpensAt?: string;
  paymentDueAt?: string;
  additionalOpensAt?: string;
  /** Omitted keeps the event's current overdue policy. */
  overdueRelease?: OverdueRelease;
  overdueGraceDays?: number;
  registrationMode: RegistrationMode;
  discordPolicy?: DiscordPolicy;
  timeZone: string;
}

export interface EventMutationInput {
  actorUserId: string;
  eventId: string;
  reason?: string;
}
