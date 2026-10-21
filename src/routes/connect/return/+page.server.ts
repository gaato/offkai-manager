import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getApp } from '$lib/server/app';
import { getDatabaseClient } from '$lib/server/db/client';
import { syncAccount } from '$lib/server/domain/payments/connect';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
  const actor = requireSession(event);
  const org = z.uuid().safeParse(event.url.searchParams.get('org'));
  if (!org.success) throw error(400);
  const config = getConfig();
  const gateway = getApp(config).stripe.connect;
  if (!gateway) throw error(503);
  await syncAccount(getDatabaseClient(config), gateway, org.data, actor);
  throw redirect(303, `/app/organizations/${org.data}/payouts`);
};
