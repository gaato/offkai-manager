import { error, isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { ConnectError, refreshOnboarding } from '$lib/server/domain/payments';

export const GET: RequestHandler = async (event) => {
  const session = requireSession(event);
  const organizationId = z.uuid().safeParse(event.params.orgId);
  if (!organizationId.success) throw error(404);
  const config = getConfig();
  const stripe = getApp(config).stripe;
  if (stripe.mode === 'disabled') throw error(404);
  const base = `/app/organizations/${organizationId.data}/stripe`;
  try {
    const url = await refreshOnboarding(getDatabaseClient(config), stripe.connect, {
      organizationId: organizationId.data,
      actor: session,
      returnUrl: new URL(`${base}/return`, config.auth.publicBaseUrl).toString(),
      refreshUrl: new URL(`${base}/refresh`, config.auth.publicBaseUrl).toString()
    });
    throw redirect(303, url);
  } catch (cause) {
    if (isRedirect(cause)) throw cause;
    event.locals.logger[cause instanceof ConnectError ? 'warn' : 'error'](
      { err: cause },
      'refresh Stripe onboarding link failed'
    );
    if (cause instanceof ConnectError && cause.code === 'forbidden') throw error(403);
    if (cause instanceof ConnectError && cause.code === 'not_connected') throw error(409);
    throw error(500);
  }
};
