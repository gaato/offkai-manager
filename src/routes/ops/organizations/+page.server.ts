import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { listPlatformOrganizations } from '$lib/server/domain/platform';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  try {
    const config = getConfig();
    const organizations = await listPlatformOrganizations(getDatabaseClient(config));
    return {
      organizations: organizations.map((organization) => ({
        ...organization,
        createdAtLabel: formatWallClock(
          organization.createdAt,
          event.locals.locale,
          config.time.zone
        )
      }))
    };
  } catch (cause) {
    event.locals.logger.error({ err: cause }, 'load platform organizations failed');
    throw error(500);
  }
};
