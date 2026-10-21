import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getPlatformUser, PlatformError } from '$lib/server/domain/platform';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const userId = z.uuid().safeParse(event.params.userId);
  if (!userId.success) throw error(404);
  try {
    const config = getConfig();
    const detail = await getPlatformUser(getDatabaseClient(config), userId.data, config.tuning);
    return {
      ...detail,
      user: {
        ...detail.user,
        createdAtLabel: formatWallClock(
          detail.user.createdAt,
          event.locals.locale,
          config.time.zone
        )
      },
      recentAudits: detail.recentAudits.map((audit) => ({
        ...audit,
        createdAtLabel: formatWallClock(audit.createdAt, event.locals.locale, config.time.zone)
      }))
    };
  } catch (cause) {
    if (cause instanceof PlatformError && cause.code === 'not_found') throw error(404);
    event.locals.logger.error({ err: cause }, 'load platform user detail failed');
    throw error(500);
  }
};
