import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  listParticipants,
  participantStatusFilter,
  participantStatusFilters,
  RegistrationError
} from '$lib/server/domain/registrations';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const data = await event.parent();
  const session = requireSession(event);
  const query = event.url.searchParams.get('q')?.trim().slice(0, 200) ?? '';
  const status = participantStatusFilter(event.url.searchParams.get('status'));
  try {
    const result = await listParticipants(getDatabaseClient(getConfig()), {
      actorUserId: session.userId,
      eventId: data.event.id,
      status,
      query
    });
    return {
      ...result,
      query,
      status,
      filters: participantStatusFilters,
      rows: result.rows.map((row) => ({
        ...row,
        registeredAtLabel: formatWallClock(
          row.registeredAt,
          event.locals.locale,
          getConfig().time.zone
        )
      }))
    };
  } catch (cause) {
    if (
      (cause instanceof RegistrationError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load participants failed');
    throw error(500);
  }
};
