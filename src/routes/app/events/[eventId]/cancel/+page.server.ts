import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { cancelEvent, EventError } from '$lib/server/domain/events';
import { OrganizationError } from '$lib/server/domain/orgs';

export const load: PageServerLoad = async ({ parent }) => {
  const data = await parent();
  if (!data.capabilities.canManageEvent || data.event.cancelledAt || data.event.archivedAt) {
    throw error(404);
  }
  return {};
};

export const actions: Actions = {
  cancel: async (event) => {
    const session = requireSession(event);
    const eventId = z.uuid().safeParse(event.params.eventId);
    if (!eventId.success) throw error(404);
    const data = z
      .object({ reason: z.string().trim().min(1).max(2_000) })
      .safeParse(Object.fromEntries(await event.request.formData()));
    if (!data.success) {
      return fail(400, {
        actionError: event.locals.t('event.error_validation'),
        reason: String(data.error.issues[0]?.input ?? '')
      });
    }
    try {
      await cancelEvent(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        eventId: eventId.data,
        reason: data.data.reason
      });
    } catch (cause) {
      event.locals.logger[
        cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'cancel event failed');
      const actionError =
        cause instanceof EventError && cause.code === 'illegal_transition'
          ? event.locals.t('event.error_illegal_transition')
          : cause instanceof OrganizationError && cause.code === 'forbidden'
            ? event.locals.t('event.error_forbidden')
            : event.locals.t('event.error_generic');
      return fail(cause instanceof EventError ? 409 : 500, {
        actionError,
        reason: data.data.reason
      });
    }
    throw redirect(303, `/app/events/${eventId.data}`);
  }
};
