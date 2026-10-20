import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  changeRegistrationStatus,
  getAdminRegistrationDetail,
  RegistrationError
} from '$lib/server/domain/registrations';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClock } from '$lib/server/time';

const changedSchema = z.enum(['confirmed', 'waitlisted', 'cancelled']);

export const load: PageServerLoad = async (event) => {
  const session = requireSession(event);
  const registrationId = registrationIdFrom(event);
  try {
    const config = getConfig();
    const detail = await getAdminRegistrationDetail(
      getDatabaseClient(config),
      session.userId,
      registrationId
    );
    const changed = changedSchema.safeParse(event.url.searchParams.get('changed'));
    return {
      ...detail,
      changed: changed.success ? changed.data : null,
      registeredAtLabel: formatWallClock(
        detail.registration.createdAt,
        event.locals.locale,
        config.time.zone
      ),
      audits: detail.audits.map((audit) => ({
        ...audit,
        createdAtLabel: formatWallClock(audit.createdAt, event.locals.locale, config.time.zone)
      }))
    };
  } catch (cause) {
    if (
      (cause instanceof RegistrationError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load admin registration failed');
    throw error(500);
  }
};

export const actions: Actions = {
  confirm: (event) => mutate(event, 'confirmed'),
  waitlist: (event) => mutate(event, 'waitlisted'),
  cancel: (event) => mutate(event, 'cancelled')
};

async function mutate(event: RequestEvent, status: 'confirmed' | 'waitlisted' | 'cancelled') {
  const session = requireSession(event);
  const registrationId = registrationIdFrom(event);
  try {
    await changeRegistrationStatus(getDatabaseClient(getConfig()), {
      actorUserId: session.userId,
      registrationId,
      status
    });
  } catch (cause) {
    event.locals.logger[
      cause instanceof RegistrationError || cause instanceof OrganizationError ? 'warn' : 'error'
    ]({ err: cause }, 'change registration status failed');
    return fail(mutationStatus(cause), { actionError: mutationMessage(event, cause) });
  }
  throw redirect(303, `/app/registrations/${registrationId}?changed=${status}`);
}

function registrationIdFrom(event: Pick<RequestEvent, 'params'>): string {
  const parsed = z.uuid().safeParse(event.params.registrationId);
  if (!parsed.success) throw error(404);
  return parsed.data;
}

function mutationStatus(cause: unknown): 403 | 404 | 409 | 500 {
  if (cause instanceof RegistrationError) {
    if (cause.code === 'not_found') return 404;
    if (cause.code === 'capacity' || cause.code === 'illegal_transition') return 409;
  }
  if (cause instanceof OrganizationError) {
    return cause.code === 'not_found' ? 404 : 403;
  }
  return 500;
}

function mutationMessage(event: RequestEvent, cause: unknown): string {
  if (cause instanceof RegistrationError && cause.code === 'capacity') {
    return event.locals.t('admin_registration.error_capacity');
  }
  if (cause instanceof RegistrationError && cause.code === 'illegal_transition') {
    return event.locals.t('admin_registration.error_transition');
  }
  if (cause instanceof OrganizationError && cause.code === 'forbidden') {
    return event.locals.t('admin_registration.error_forbidden');
  }
  return event.locals.t('admin_registration.error_generic');
}
