import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { archiveEvent, EventError } from '$lib/server/domain/events';
import { OrganizationError } from '$lib/server/domain/orgs';

export const load: PageServerLoad = async ({ parent }) => {
  const data = await parent();
  if (!data.capabilities.canManageEvent || data.event.archivedAt) throw error(404);
  return {};
};

export const actions: Actions = {
  archive: async (event) => {
    const session = requireSession(event);
    const eventId = z.uuid().safeParse(event.params.eventId);
    if (!eventId.success) throw error(404);
    try {
      await archiveEvent(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        eventId: eventId.data
      });
    } catch (cause) {
      event.locals.logger[
        cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'archive event failed');
      const actionError =
        cause instanceof EventError && cause.code === 'illegal_transition'
          ? event.locals.t('event.error_illegal_transition')
          : cause instanceof OrganizationError && cause.code === 'forbidden'
            ? event.locals.t('event.error_forbidden')
            : event.locals.t('event.error_generic');
      return fail(cause instanceof EventError ? 409 : 500, { actionError });
    }
    throw redirect(303, `/app/events/${eventId.data}`);
  }
};
