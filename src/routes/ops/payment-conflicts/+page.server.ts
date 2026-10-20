import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { listPlatformPaymentConflicts } from '$lib/server/domain/platform';
import { formatWallClock } from '$lib/server/time';
import { formatMoney } from '$lib/shared/money';

export const load: PageServerLoad = async (event) => {
  try {
    const config = getConfig();
    const rows = await listPlatformPaymentConflicts(getDatabaseClient(config));
    return {
      rows: rows.map((row) => ({
        ...row,
        amountLabel: formatMoney(row.amountMinor, row.currency, event.locals.locale),
        occurredAtLabel: formatWallClock(row.occurredAt, event.locals.locale, config.time.zone)
      }))
    };
  } catch (cause) {
    event.locals.logger.error({ err: cause }, 'load platform payment conflicts failed');
    throw error(500);
  }
};
