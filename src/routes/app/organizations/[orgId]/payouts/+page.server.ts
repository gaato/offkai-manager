import { ConnectError } from '$lib/server/domain/payments/errors';
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getApp } from '$lib/server/app';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  ensureConnectedAccount,
  getConnectAccount,
  startOnboarding,
  syncAccount
} from '$lib/server/domain/payments/connect';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
const context = (event: RequestEvent) => {
  const actor = requireSession(event);
  const org = z.uuid().safeParse(event.params.orgId);
  if (!org.success) throw error(404);
  const config = getConfig();
  return {
    actor,
    orgId: org.data,
    config,
    client: getDatabaseClient(config),
    gateway: getApp(config).stripe.connect
  };
};
export const load: PageServerLoad = async (event) => {
  const { actor, orgId, config, client, gateway } = context(event);
  let account = await getConnectAccount(client, orgId, actor);
  const parent = await event.parent();
  if (!parent.capabilities.canManageStripe) throw error(403);
  let refreshFailed = false;
  if (account && gateway) {
    try {
      account = await syncAccount(client, gateway, orgId, actor);
    } catch (cause) {
      event.locals.logger.warn({ err: cause }, 'payout readiness refresh failed');
      refreshFailed = true;
    }
  }
  return {
    account,
    refreshFailed,
    publishableKey: config.stripe.publishableKey || (config.auth.devBypass ? 'pk_test_stub' : ''),
    sessionEndpoint: `/app/organizations/${orgId}/payouts/session`
  };
};
const onboardingInput = (orgId: string, actor: { userId: string }, base: string) => ({
  organizationId: orgId,
  actor,
  returnUrl: `${base}/connect/return?org=${orgId}`,
  refreshUrl: `${base}/connect/refresh?org=${orgId}`
});
export const actions: Actions = {
  create: async (event) => {
    const { actor, orgId, config, client, gateway } = context(event);
    if (!gateway) return fail(503, { problem: event.locals.t('stripe.not_configured') });
    try {
      await ensureConnectedAccount(
        client,
        gateway,
        onboardingInput(orgId, actor, config.auth.publicBaseUrl)
      );
    } catch (cause) {
      if (cause instanceof ConnectError && cause.code === 'forbidden') throw error(403);
      event.locals.logger.error({ err: cause }, 'create payout account failed');
      return fail(500, { problem: event.locals.t('stripe.error_generic') });
    }
    throw redirect(303, `/app/organizations/${orgId}/payouts`);
  },
  hosted: async (event) => {
    const { actor, orgId, config, client, gateway } = context(event);
    if (!gateway) return fail(503, { problem: event.locals.t('stripe.not_configured') });
    const url = await startOnboarding(
      client,
      gateway,
      onboardingInput(orgId, actor, config.auth.publicBaseUrl)
    );
    throw redirect(303, url);
  }
};
