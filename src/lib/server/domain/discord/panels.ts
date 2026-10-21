import { and, asc, count, desc, eq, isNull, ne, inArray } from 'drizzle-orm';
import { systemClock, type Clock } from '$lib/server/clock';
import { read, write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import {
  collections,
  discordPanels,
  eventDiscordIntegrations,
  events,
  organizations,
  organizationMemberships,
  registrations
} from '$lib/server/db/schema';
import { escapeLikePattern, ilike } from '$lib/server/db/search';
import { enqueuePanelRefresh } from './outbox';
import { appendAudit } from '$lib/server/domain/audit';
import { loadActiveFormFields } from '$lib/server/domain/events/forms';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs/authorization';
import { RegistrationError } from '$lib/server/domain/registrations/errors';
import { assertRegistrationActor } from '$lib/server/domain/registrations/answers';
import { registrationStatusSchema } from '$lib/shared/registration';
import type { Locale } from '$lib/i18n';

export class PanelError extends Error {
  constructor(readonly code: 'no_guild' | 'wrong_guild' | 'unavailable' | 'paid' | 'exists') {
    super(code);
  }
}

export function loadPanelEvent(tx: DatabaseTransaction, eventId: string) {
  const row = tx
    .select({
      event: events,
      guildId: eventDiscordIntegrations.guildId,
      organizationSlug: organizations.slug,
      suspendedAt: organizations.suspendedAt
    })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .leftJoin(eventDiscordIntegrations, eq(eventDiscordIntegrations.eventId, events.id))
    .where(eq(events.id, eventId))
    .get();
  if (!row) throw new PanelError('unavailable');
  const confirmed = tx
    .select({ value: count() })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, 'confirmed')))
    .get()!.value;
  return { ...row, counts: { confirmed }, fields: loadActiveFormFields(tx, eventId) };
}
function assertGuild(actual: string | null | undefined, guildId: string | undefined): void {
  if (!actual) throw new PanelError('no_guild');
  if (!guildId || actual !== guildId) throw new PanelError('wrong_guild');
}
export function assertFreeEvent(tx: DatabaseTransaction, eventId: string): void {
  const paid = tx
    .select()
    .from(collections)
    .where(and(eq(collections.eventId, eventId), ne(collections.status, 'archived')))
    .all()
    .some((collection) => collection.amountMinor > 0n);
  if (paid) throw new PanelError('paid');
}
export function getManageablePanelEvent(
  client: DatabaseClient,
  eventId: string,
  guildId: string | undefined,
  userId: string
) {
  return read(client, (tx) => {
    const data = loadPanelEvent(tx, eventId);
    assertRegistrationActor(tx, userId, eventId);
    authorizeOrganizationRole(tx, data.event.organizationId, userId, 'organizer');
    assertGuild(data.guildId, guildId);
    if (
      data.event.visibility === 'draft' ||
      data.event.archivedAt ||
      data.event.cancelledAt ||
      data.suspendedAt
    )
      throw new PanelError('unavailable');
    assertFreeEvent(tx, eventId);
    return data;
  });
}
export function getParticipantPanelEvent(
  client: DatabaseClient,
  eventId: string,
  guildId: string | undefined,
  userId: string
) {
  return read(client, (tx) => {
    const data = loadPanelEvent(tx, eventId);
    assertGuild(data.guildId, guildId);
    assertRegistrationActor(tx, userId, eventId);
    if (data.event.visibility === 'draft') throw new PanelError('unavailable');
    const registration = tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.userId, userId)))
      // Prefer the active row; cancelled attempts remain history with their old numbers.
      .orderBy(asc(registrations.status), desc(registrations.number))
      .all();
    const current = registration.find((row) => row.status !== 'cancelled') ?? registration[0];
    return {
      ...data,
      registration: current
        ? { ...current, status: registrationStatusSchema.parse(current.status) }
        : null
    };
  });
}
export function autocompletePanelEvents(
  client: DatabaseClient,
  userId: string,
  title: string,
  guildId: string | undefined
) {
  return read(client, (tx) =>
    tx
      .select({ name: events.title, value: events.id })
      .from(events)
      .innerJoin(organizations, eq(organizations.id, events.organizationId))
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.organizationId, organizations.id),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active')
        )
      )
      .innerJoin(eventDiscordIntegrations, eq(eventDiscordIntegrations.eventId, events.id))
      .where(
        and(
          isNull(organizations.suspendedAt),
          isNull(events.archivedAt),
          isNull(events.cancelledAt),
          ne(events.visibility, 'draft'),
          eq(eventDiscordIntegrations.guildId, guildId ?? ''),
          inArray(organizationMemberships.role, ['owner', 'organizer']),
          ilike(events.title, `%${escapeLikePattern(title)}%`)
        )
      )
      .orderBy(asc(events.title), asc(events.id))
      .limit(25)
      .all()
      .map((row) => ({ ...row, name: row.name.slice(0, 100) }))
  );
}
export function storeDiscordPanel(
  client: DatabaseClient,
  input: {
    eventId: string;
    userId: string;
    guildId: string;
    channelId: string;
    messageId: string;
    locale: Locale;
  },
  clock: Clock = systemClock
): void {
  write(client, (tx) => {
    const data = loadPanelEvent(tx, input.eventId);
    assertRegistrationActor(tx, input.userId, input.eventId);
    authorizeOrganizationRole(tx, data.event.organizationId, input.userId, 'organizer');
    assertGuild(data.guildId, input.guildId);
    const panel = tx
      .insert(discordPanels)
      .values({ ...input, createdAt: clock.now() })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!panel) throw new PanelError('exists');
    enqueuePanelRefresh(tx, input.eventId, clock);
    appendAudit(
      tx,
      {
        actorUserId: input.userId,
        eventId: input.eventId,
        action: 'discord.panel_post',
        targetType: 'discord_panel',
        targetId: panel.id,
        after: { locale: input.locale, channelId: input.channelId }
      },
      clock
    );
  });
}
export function requireActiveRegistration(data: ReturnType<typeof getParticipantPanelEvent>) {
  if (!data.registration || data.registration.status === 'cancelled')
    throw new RegistrationError('not_found', 'active registration not found');
  return data.registration;
}

export function activePanel(client: DatabaseClient, eventId: string, locale: Locale) {
  return read(client, (tx) =>
    tx
      .select()
      .from(discordPanels)
      .where(
        and(
          eq(discordPanels.eventId, eventId),
          eq(discordPanels.locale, locale),
          isNull(discordPanels.deletedAt)
        )
      )
      .get()
  );
}
