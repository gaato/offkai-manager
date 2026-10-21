import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { listEventActivity } from '$lib/server/domain/activity';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const data = await event.parent();
  const session = requireSession(event);
  try {
    const config = getConfig();
    const rows = await listEventActivity(
      getDatabaseClient(config),
      session.userId,
      data.event.id,
      config.tuning
    );
    return {
      rows: rows.map((row) => ({
        ...row,
        createdAtLabel: formatWallClock(row.createdAt, event.locals.locale, config.time.zone)
      }))
    };
  } catch (cause) {
    if (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code)) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load event activity failed');
    throw error(500);
  }
};
