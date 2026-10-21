import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getApp } from '$lib/server/app';
import { getDatabaseClient } from '$lib/server/db/client';
import { refreshOnboarding } from '$lib/server/domain/payments/connect';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
  const actor = requireSession(event);
  const org = z.uuid().safeParse(event.url.searchParams.get('org'));
  if (!org.success) throw error(400);
  const config = getConfig();
  const gateway = getApp(config).stripe.connect;
  if (!gateway) throw error(503);
  const url = await refreshOnboarding(getDatabaseClient(config), gateway, {
    organizationId: org.data,
    actor,
    returnUrl: `${config.auth.publicBaseUrl}/connect/return?org=${org.data}`,
    refreshUrl: `${config.auth.publicBaseUrl}/connect/refresh?org=${org.data}`
  });
  throw redirect(303, url);
};
