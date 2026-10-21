import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { events, eventDiscordIntegrations, organizations, users } from '$lib/server/db/schema';
import { authorizeOrganizationRole } from '../orgs/authorization';
import { OrganizationError } from '../orgs/errors';

/** These roles come only from the signed guild interaction, never from command options. */
export interface DoorActor {
  actorUserId: string;
  guildId: string;
  roles: readonly string[];
}
export function authorizeDoorStaff(
  tx: DatabaseTransaction,
  eventId: string,
  actor: DoorActor,
  organizerOnly = false
) {
  const row = tx
    .select({ event: events, integration: eventDiscordIntegrations })
    .from(events)
    .innerJoin(eventDiscordIntegrations, eq(eventDiscordIntegrations.eventId, events.id))
    .where(eq(events.id, eventId))
    .get();
  if (!row || !actor.guildId || row.integration.guildId !== actor.guildId)
    throw new OrganizationError('forbidden', 'wrong guild');
  const user = tx.select().from(users).where(eq(users.id, actor.actorUserId)).get();
  const org = tx
    .select()
    .from(organizations)
    .where(eq(organizations.id, row.event.organizationId))
    .get();
  if (!user || user.suspendedAt || !org || org.suspendedAt)
    throw new OrganizationError('forbidden', 'actor unavailable');
  if (row.event.archivedAt || row.event.cancelledAt || row.event.visibility === 'draft')
    throw new OrganizationError('forbidden', 'event unavailable');
  if (
    !organizerOnly &&
    row.integration.staffRoleId &&
    actor.roles.includes(row.integration.staffRoleId)
  )
    return row.event;
  authorizeOrganizationRole(tx, row.event.organizationId, actor.actorUserId, 'organizer');
  return row.event;
}
