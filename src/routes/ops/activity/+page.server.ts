import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { searchPlatformActivity } from '$lib/server/domain/platform';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const actionPrefix = event.url.searchParams.get('action')?.slice(0, 200) ?? '';
  const targetId = event.url.searchParams.get('target')?.slice(0, 200) ?? '';
  const rawPage = Number(event.url.searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  try {
    const config = getConfig();
    const result = await searchPlatformActivity(
      getDatabaseClient(config),
      {
        actionPrefix,
        targetId,
        page
      },
      config.tuning
    );
    return {
      actionPrefix,
      targetId,
      rows: result.rows.map((row) => ({
        ...row,
        createdAtLabel: formatWallClock(row.createdAt, event.locals.locale, config.time.zone)
      })),
      previousHref: result.hasPrevious
        ? activityHref(actionPrefix, targetId, result.page - 1)
        : null,
      nextHref: result.hasNext ? activityHref(actionPrefix, targetId, result.page + 1) : null
    };
  } catch (cause) {
    event.locals.logger.error({ err: cause }, 'search platform activity failed');
    throw error(500);
  }
};

function activityHref(actionPrefix: string, targetId: string, page: number): string {
  const query = new URLSearchParams();
  if (actionPrefix) query.set('action', actionPrefix);
  if (targetId) query.set('target', targetId);
  if (page > 1) query.set('page', String(page));
  const encoded = query.toString();
  return encoded ? `/ops/activity?${encoded}` : '/ops/activity';
}
