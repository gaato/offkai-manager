import { OrganizationError } from '$lib/server/domain/orgs';
import { CheckInError } from '$lib/server/domain/checkin/service';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getRoster } from '$lib/server/domain/checkin/roster';
export const load: PageServerLoad = (event) => {
  const user = requireSession(event);
  const id = z.uuid().safeParse(event.params.eventId);
  if (!id.success) throw error(404);
  event.setHeaders({ 'Cache-Control': 'private, no-store' });
  try {
    return { rows: getRoster(getDatabaseClient(getConfig()), user.userId, id.data) };
  } catch (cause) {
    if (cause instanceof OrganizationError || cause instanceof CheckInError) throw error(404);
    throw cause;
  }
};
