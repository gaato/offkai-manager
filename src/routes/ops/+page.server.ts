import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getPlatformDashboard } from '$lib/server/domain/platform';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  try {
    const config = getConfig();
    const dashboard = await getPlatformDashboard(getDatabaseClient(config), config.tuning);
    return {
      ...dashboard,
      recentAudits: dashboard.recentAudits.map((row) => ({
        ...row,
        createdAtLabel: formatWallClock(row.createdAt, event.locals.locale, config.time.zone)
      }))
    };
  } catch (cause) {
    event.locals.logger.error({ err: cause }, 'load platform dashboard failed');
    throw error(500);
  }
};
