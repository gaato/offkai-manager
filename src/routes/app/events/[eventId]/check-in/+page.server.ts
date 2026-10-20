import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  CheckInError,
  getCheckInOverview,
  recordCheckIn,
  undoCheckIn
} from '$lib/server/domain/checkin';
import { OrganizationError } from '$lib/server/domain/orgs';

const actionSchema = z.object({
  registrationId: z.uuid(),
  q: z.string().trim().max(200).default('')
});

export const load: PageServerLoad = async (event) => {
  const data = await event.parent();
  const session = requireSession(event);
  const query = event.url.searchParams.get('q')?.trim().slice(0, 200) ?? '';
  const changed = z.enum(['record', 'undo']).safeParse(event.url.searchParams.get('changed'));
  try {
    return {
      ...(await getCheckInOverview(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        eventId: data.event.id,
        query
      })),
      query,
      changed: changed.success ? changed.data : null
    };
  } catch (cause) {
    if (
      (cause instanceof CheckInError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load check-in failed');
    throw error(500);
  }
};

export const actions: Actions = {
  record: (event) => mutate(event, 'record'),
  undo: (event) => mutate(event, 'undo')
};

async function mutate(event: RequestEvent, operation: 'record' | 'undo') {
  const session = requireSession(event);
  const parsed = actionSchema.safeParse(Object.fromEntries(await event.request.formData()));
  if (!parsed.success) {
    return fail(400, { actionError: event.locals.t('checkin.error_validation') });
  }
  try {
    await (operation === 'record' ? recordCheckIn : undoCheckIn)(getDatabaseClient(getConfig()), {
      actorUserId: session.userId,
      registrationId: parsed.data.registrationId
    });
  } catch (cause) {
    event.locals.logger[
      cause instanceof CheckInError || cause instanceof OrganizationError ? 'warn' : 'error'
    ]({ err: cause }, `${operation} check-in failed`);
    return fail(checkInStatus(cause), { actionError: checkInMessage(event, cause) });
  }
  const parameters = new URLSearchParams({ changed: operation });
  if (parsed.data.q) parameters.set('q', parsed.data.q);
  throw redirect(303, `${event.url.pathname}?${parameters}`);
}

function checkInStatus(cause: unknown): 403 | 404 | 409 | 500 {
  if (cause instanceof CheckInError) {
    if (cause.code === 'not_found') return 404;
    if (['duplicate', 'not_confirmed', 'not_checked_in'].includes(cause.code)) return 409;
  }
  if (cause instanceof OrganizationError) return cause.code === 'not_found' ? 404 : 403;
  return 500;
}

function checkInMessage(event: RequestEvent, cause: unknown): string {
  if (cause instanceof CheckInError && cause.code === 'duplicate') {
    return event.locals.t('checkin.error_duplicate');
  }
  if (cause instanceof CheckInError && cause.code === 'not_confirmed') {
    return event.locals.t('checkin.error_not_confirmed');
  }
  if (cause instanceof CheckInError && cause.code === 'not_checked_in') {
    return event.locals.t('checkin.error_not_checked_in');
  }
  if (cause instanceof OrganizationError && cause.code === 'forbidden') {
    return event.locals.t('checkin.error_forbidden');
  }
  return event.locals.t('checkin.error_generic');
}
