import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { LayoutServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { EventError, getEventAccess } from '$lib/server/domain/events';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClock } from '$lib/server/time';
import { capabilitiesForRole, readOnlyOrganizationCapabilities } from '$lib/shared/organization';

export const load: LayoutServerLoad = async (event) => {
  const session = requireSession(event);
  const eventId = z.uuid().safeParse(event.params.eventId);
  if (!eventId.success) throw error(404);
  try {
    const config = getConfig();
    const access = await getEventAccess(getDatabaseClient(config), session.userId, eventId.data);
    return {
      event: access.event,
      organizationSlug: access.organizationSlug,
      actorRole: access.actorRole,
      organizationSuspended: access.organizationSuspendedAt !== null,
      capabilities: access.organizationSuspendedAt
        ? readOnlyOrganizationCapabilities()
        : capabilitiesForRole(access.actorRole),
      formattedStart: formatWallClock(access.event.startsAt, event.locals.locale, config.time.zone),
      formattedEnd: formatWallClock(access.event.endsAt, event.locals.locale, config.time.zone)
    };
  } catch (cause) {
    if (
      (cause instanceof EventError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load event workspace failed');
    throw error(500);
  }
};
