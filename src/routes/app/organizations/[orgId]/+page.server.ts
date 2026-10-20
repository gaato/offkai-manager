import { error, fail, isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { listEventsForOrganization } from '$lib/server/domain/events';
import {
  ConnectError,
  getConnectAccount,
  startOnboarding,
  syncAccount
} from '$lib/server/domain/payments';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async (event) => {
  const session = requireSession(event);
  const organizationId = z.uuid().safeParse(event.params.orgId);
  if (!organizationId.success) throw error(404);
  const config = getConfig();
  const client = getDatabaseClient(config);
  const [eventRows, stripeAccount] = await Promise.all([
    listEventsForOrganization(client, session.userId, organizationId.data),
    getConnectAccount(client, organizationId.data, session)
  ]);
  return {
    events: eventRows.map((item) => ({
      ...item,
      formattedStartsAt: formatWallClock(item.startsAt, event.locals.locale, config.time.zone)
    })),
    stripeMode: getApp(config).stripe.mode,
    stripeAccount,
    stripeFlash:
      event.url.searchParams.get('stripe') === 'returned'
        ? event.locals.t('stripe.return_success')
        : null
  };
};

export const actions: Actions = {
  startOnboarding: async (event) => {
    const context = actionContext(event);
    if (!context) return fail(503, { stripeActionError: event.locals.t('stripe.not_configured') });
    try {
      const url = await startOnboarding(context.client, context.gateway, context.input);
      throw redirect(303, url);
    } catch (cause) {
      if (isRedirect(cause)) throw cause;
      return connectFailure(event, cause, 'start Stripe onboarding');
    }
  },
  syncStatus: async (event) => {
    const context = actionContext(event);
    if (!context) return fail(503, { stripeActionError: event.locals.t('stripe.not_configured') });
    try {
      await syncAccount(
        context.client,
        context.gateway,
        context.input.organizationId,
        context.input.actor
      );
      return { stripeActionMessage: event.locals.t('stripe.sync_success') };
    } catch (cause) {
      return connectFailure(event, cause, 'sync Stripe account');
    }
  }
};

function actionContext(event: RequestEvent) {
  const session = requireSession(event);
  const organizationId = z.uuid().safeParse(event.params.orgId);
  if (!organizationId.success) throw error(404);
  const config = getConfig();
  const stripe = getApp(config).stripe;
  if (stripe.mode === 'disabled') return null;
  const base = `/app/organizations/${organizationId.data}/stripe`;
  return {
    client: getDatabaseClient(config),
    gateway: stripe.connect,
    input: {
      organizationId: organizationId.data,
      actor: session,
      returnUrl: new URL(`${base}/return`, config.auth.publicBaseUrl).toString(),
      refreshUrl: new URL(`${base}/refresh`, config.auth.publicBaseUrl).toString()
    }
  };
}

function connectFailure(event: RequestEvent, cause: unknown, operation: string) {
  event.locals.logger[cause instanceof ConnectError ? 'warn' : 'error'](
    { err: cause },
    `${operation} failed`
  );
  if (cause instanceof ConnectError && cause.code === 'forbidden') {
    return fail(403, { stripeActionError: event.locals.t('stripe.error_forbidden') });
  }
  if (cause instanceof ConnectError && cause.code === 'not_found') {
    return fail(404, { stripeActionError: event.locals.t('stripe.error_generic') });
  }
  if (cause instanceof ConnectError && cause.code === 'not_connected') {
    return fail(409, { stripeActionError: event.locals.t('stripe.error_not_connected') });
  }
  return fail(500, { stripeActionError: event.locals.t('stripe.error_generic') });
}
