import { ConnectError } from '$lib/server/domain/payments/errors';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getApp } from '$lib/server/app';
import { getDatabaseClient } from '$lib/server/db/client';
import { createEmbeddedSession } from '$lib/server/domain/payments/connect';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
  const actor = requireSession(event);
  const org = z.uuid().safeParse(event.params.orgId);
  if (!org.success) throw error(404);
  const config = getConfig();
  const gateway = getApp(config).stripe.connect;
  if (!gateway) throw error(503);
  try {
    return json(await createEmbeddedSession(getDatabaseClient(config), gateway, org.data, actor), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (cause) {
    if (cause instanceof ConnectError && cause.code === 'forbidden') throw error(403);
    event.locals.logger.warn({ err: cause }, 'Account Session failed');
    throw error(503, event.locals.t('stripe.error_generic'));
  }
};
