import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { searchPlatformUsers } from '$lib/server/domain/platform';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const query = event.url.searchParams.get('q')?.trim().slice(0, 128) ?? '';
  try {
    const config = getConfig();
    const users = await searchPlatformUsers(getDatabaseClient(config), query, config.tuning);
    return {
      query,
      users: users.map((user) => ({
        ...user,
        createdAtLabel: formatWallClock(user.createdAt, event.locals.locale, config.time.zone)
      }))
    };
  } catch (cause) {
    event.locals.logger.error({ err: cause }, 'search platform users failed');
    throw error(500);
  }
};
