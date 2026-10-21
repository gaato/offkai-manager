import { OrganizationError } from '$lib/server/domain/orgs';
import { CheckInError } from '$lib/server/domain/checkin/service';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getRoster } from '$lib/server/domain/checkin/roster';
import { buildRosterCSV } from '$lib/server/exports/roster';
export const GET: RequestHandler = (event) => {
  const user = requireSession(event);
  const id = z.uuid().safeParse(event.params.eventId);
  if (!id.success) throw error(404);
  try {
    return new Response(
      buildRosterCSV(
        getRoster(getDatabaseClient(getConfig()), user.userId, id.data),
        event.locals.locale
      ),
      {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="reception.csv"',
          'Cache-Control': 'private, no-store'
        }
      }
    );
  } catch (cause) {
    if (cause instanceof OrganizationError || cause instanceof CheckInError) throw error(404);
    throw cause;
  }
};
