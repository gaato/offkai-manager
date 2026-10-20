import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { ConnectError, handleReturn } from '$lib/server/domain/payments';

export const GET: RequestHandler = async (event) => {
  const session = requireSession(event);
  const organizationId = z.uuid().safeParse(event.params.orgId);
  if (!organizationId.success) throw error(404);
  const config = getConfig();
  const stripe = getApp(config).stripe;
  if (stripe.mode === 'disabled') throw error(404);
  try {
    await handleReturn(getDatabaseClient(config), stripe.connect, organizationId.data, session);
  } catch (cause) {
    event.locals.logger[cause instanceof ConnectError ? 'warn' : 'error'](
      { err: cause },
      'handle Stripe onboarding return failed'
    );
    if (cause instanceof ConnectError && cause.code === 'forbidden') throw error(403);
    if (cause instanceof ConnectError && cause.code === 'not_connected') throw error(409);
    throw error(500);
  }
  throw redirect(303, `/app/organizations/${organizationId.data}?stripe=returned`);
};
