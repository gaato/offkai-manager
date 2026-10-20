import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  canWithdrawRegistration,
  getOwnedRegistration,
  RegistrationError,
  withdrawRegistration
} from '$lib/server/domain/registrations';

function requireId(raw: string | undefined): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw error(404);
  return parsed.data;
}

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'Cache-Control': 'private, no-store' });
  if (!event.locals.session) throw error(404);
  const registrationId = requireId(event.params.registrationId);
  try {
    const detail = await getOwnedRegistration(
      getDatabaseClient(getConfig()),
      registrationId,
      event.locals.session.userId
    );
    if (!canWithdrawRegistration(detail)) {
      throw new RegistrationError('not_withdrawable', 'registration cannot be withdrawn');
    }
    return {
      eventTitle: detail.event.title,
      statusHref: `/registrations/${registrationId}`
    };
  } catch (cause) {
    if (cause instanceof RegistrationError && cause.code === 'not_found') throw error(404);
    if (cause instanceof RegistrationError && cause.code === 'not_withdrawable') {
      throw error(409, event.locals.t('withdraw.not_allowed'));
    }
    event.locals.logger.error({ err: cause }, 'load withdrawal confirmation failed');
    throw error(500);
  }
};

export const actions: Actions = {
  withdraw: async (event) => {
    if (!event.locals.session) throw error(404);
    const registrationId = requireId(event.params.registrationId);
    try {
      await withdrawRegistration(getDatabaseClient(getConfig()), {
        registrationId,
        userId: event.locals.session.userId
      });
    } catch (cause) {
      if (cause instanceof RegistrationError && cause.code === 'not_found') throw error(404);
      if (cause instanceof RegistrationError && cause.code === 'not_withdrawable') {
        throw error(409, event.locals.t('withdraw.not_allowed'));
      }
      event.locals.logger.error({ err: cause }, 'withdraw registration failed');
      throw error(500);
    }
    throw redirect(303, `/registrations/${registrationId}?withdrawn=1`);
  }
};
