import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { participantExport, RegistrationError } from '$lib/server/domain/registrations';
import { buildParticipantCSV } from '$lib/server/exports/participants';
import { OrganizationError } from '$lib/server/domain/orgs';

export const GET: RequestHandler = async (event) => {
  const session = requireSession(event);
  const eventId = z.uuid().safeParse(event.params.eventId);
  if (!eventId.success) throw error(404);
  try {
    const config = getConfig();
    const data = await participantExport(getDatabaseClient(config), session.userId, eventId.data);
    return new Response(buildParticipantCSV(data, event.locals.locale, config.time.zone), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="event-${eventId.data}-participants.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (cause) {
    if (
      (cause instanceof RegistrationError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'export participants failed');
    throw error(500);
  }
};
