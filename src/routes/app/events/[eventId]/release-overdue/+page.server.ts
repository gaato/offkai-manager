import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  listReleasableOverdue,
  PaymentError,
  releaseOverdueRegistrations
} from '$lib/server/domain/payments';
import { OrganizationError } from '$lib/server/domain/orgs';
import { overduePolicyFromColumns, overdueReleasableAt } from '$lib/shared/overdue-policy';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const data = await event.parent();
  // Automatic policies release on their announced schedule; only manual ones release on request.
  if (
    !data.capabilities.canManageEvent ||
    data.event.archivedAt ||
    overduePolicyFromColumns(data.event).kind !== 'manual'
  )
    throw error(404);
  const session = requireSession(event);
  const config = getConfig();
  const releasableAt = data.event.paymentDueAt
    ? overdueReleasableAt(data.event.paymentDueAt, overduePolicyFromColumns(data.event))
    : null;
  return {
    overdue: listReleasableOverdue(getDatabaseClient(config), session.userId, data.event.id),
    notYet:
      releasableAt && releasableAt > new Date()
        ? formatWallClock(releasableAt, data.locale, config.time.zone)
        : ''
  };
};

export const actions: Actions = {
  release: async (event) => {
    const session = requireSession(event);
    const eventId = z.uuid().safeParse(event.params.eventId);
    if (!eventId.success) throw error(404);
    const expected = z
      .array(z.uuid())
      .max(10_000)
      .safeParse((await event.request.formData()).getAll('registrationId'));
    if (!expected.success) return fail(400, { actionError: event.locals.t('event.error_generic') });
    try {
      releaseOverdueRegistrations(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        eventId: eventId.data,
        expectedRegistrationIds: expected.data
      });
    } catch (cause) {
      event.locals.logger[
        cause instanceof PaymentError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'release overdue registrations failed');
      const forbidden = cause instanceof OrganizationError && cause.code === 'forbidden';
      const changed = cause instanceof PaymentError && cause.code === 'conflict';
      return fail(forbidden ? 403 : cause instanceof PaymentError ? 409 : 500, {
        actionError: event.locals.t(
          forbidden
            ? 'event.error_forbidden'
            : changed
              ? 'payment.overdue_release_changed'
              : 'event.error_generic'
        )
      });
    }
    throw redirect(303, `/app/events/${eventId.data}`);
  }
};
