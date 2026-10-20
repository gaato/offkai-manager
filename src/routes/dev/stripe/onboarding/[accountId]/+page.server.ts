import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';

function devGateway() {
  const config = getConfig();
  if (!config.auth.devBypass) throw error(404);
  const stripe = getApp(config).stripe;
  if (stripe.mode !== 'dev') throw error(404);
  return stripe.connect;
}

export const load: PageServerLoad = async (event) => {
  const gateway = devGateway();
  try {
    await gateway.getAccount(event.params.accountId);
  } catch {
    throw error(404);
  }
  return { accountId: event.params.accountId };
};

async function finish(event: RequestEvent, complete: boolean) {
  let returnUrl: string;
  try {
    returnUrl = devGateway().onboardingReturn(event.params.accountId, complete);
  } catch {
    throw error(404);
  }
  throw redirect(303, returnUrl);
}

export const actions: Actions = {
  complete: (event) => finish(event, true),
  incomplete: (event) => finish(event, false)
};
