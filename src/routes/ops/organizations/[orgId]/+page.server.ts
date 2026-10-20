import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getPlatformOrganization, PlatformError } from '$lib/server/domain/platform';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const organizationId = z.uuid().safeParse(event.params.orgId);
  if (!organizationId.success) throw error(404);
  try {
    const config = getConfig();
    const detail = await getPlatformOrganization(getDatabaseClient(config), organizationId.data);
    return {
      ...detail,
      organization: {
        ...detail.organization,
        createdAtLabel: formatWallClock(
          detail.organization.createdAt,
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
    event.locals.logger.error({ err: cause }, 'load platform organization detail failed');
    throw error(500);
  }
};
