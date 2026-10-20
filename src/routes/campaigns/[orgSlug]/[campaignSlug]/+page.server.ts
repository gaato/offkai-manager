import { error, fail, isHttpError, isRedirect, redirect, type RequestEvent } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { getApp } from '$lib/server/app';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  CampaignError,
  pledgeAccessTokenPlaceholder,
  publicCampaignBySlug,
  startPledgeCheckout
} from '$lib/server/domain/campaigns';
import { formatCalendarDate, formatWallClock } from '$lib/server/time';
import { formatMoney } from '$lib/shared/money';

function pledgeSchema(t: App.Locals['t'], maxUnits: number) {
  return z.object({
    displayName: z
      .string()
      .trim()
      .min(1, t('campaign.pledge.validation_name_required'))
      .max(64, t('campaign.pledge.validation_name_length')),
    unitCount: z.coerce
      .number()
      .int(t('campaign.pledge.validation_units', { max: maxUnits }))
      .min(1, t('campaign.pledge.validation_units', { max: maxUnits }))
      .max(maxUnits, t('campaign.pledge.validation_units', { max: maxUnits })),
    listPublicly: z.boolean()
  });
}

async function campaignContext(event: RequestEvent) {
  const config = getConfig();
  const organizationSlug = event.params.orgSlug;
  const campaignSlug = event.params.campaignSlug;
  if (!organizationSlug || !campaignSlug) throw error(404);
  const view = await publicCampaignBySlug(
    getDatabaseClient(config),
    organizationSlug,
    campaignSlug
  );
  if (!view) throw error(404);
  return { config, view };
}

export const load: PageServerLoad = async (event) => {
  const { config, view } = await campaignContext(event);
  const { campaign } = view;
  const description =
    campaign.description ||
    event.locals.t('campaign.meta_description', { organization: view.organizationName });
  const progress =
    campaign.goalMinor <= 0n
      ? null
      : view.raisedMinor >= campaign.goalMinor
        ? 100
        : Number((view.raisedMinor * 100n) / campaign.goalMinor);
  const contactHref = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campaign.contact)
    ? `mailto:${campaign.contact}`
    : null;
  const abuseReportHref = config.platform.abuseReportEmail
    ? `mailto:${config.platform.abuseReportEmail}?subject=${encodeURIComponent(
        event.locals.t('campaign.abuse_subject', { slug: campaign.slug })
      )}`
    : null;

  return {
    title: campaign.title,
    organizationName: view.organizationName,
    identityVerified: view.identityVerified,
    description: campaign.description,
    unitPrice: formatMoney(campaign.unitPriceMinor, campaign.currency, event.locals.locale),
    goal: formatMoney(campaign.goalMinor, campaign.currency, event.locals.locale),
    raised: formatMoney(view.raisedMinor, campaign.currency, event.locals.locale),
    supporterCount: view.orderCount,
    progress,
    fulfillmentDate: campaign.fulfillmentDate
      ? formatCalendarDate(campaign.fulfillmentDate, event.locals.locale)
      : '',
    fulfillmentNote: campaign.fulfillmentNote,
    contact: campaign.contact,
    contactHref,
    contactMissing: !campaign.contact,
    completionReportText: campaign.completionReportText,
    completionReportedAt: campaign.completionReportedAt
      ? formatWallClock(campaign.completionReportedAt, event.locals.locale, config.time.zone)
      : '',
    abuseReportHref,
    closed: campaign.status === 'closed',
    canPledge:
      campaign.status === 'open' &&
      view.connectReady &&
      Boolean(campaign.contact) &&
      getApp(config).stripe.payment !== null,
    maxUnitsPerPledge: campaign.maxUnitsPerPledge,
    supporters: view.supporters.map((supporter) => ({
      displayName: supporter.displayName,
      unitCount: supporter.unitCount
    })),
    supporterOverflowCount: view.supporterOverflowCount,
    meta: {
      description,
      url: `${config.auth.publicBaseUrl}/campaigns/${encodeURIComponent(event.params.orgSlug!)}/${encodeURIComponent(event.params.campaignSlug!)}`
    },
    form: await superValidate(
      {
        displayName: event.locals.session?.displayName ?? '',
        unitCount: 1,
        listPublicly: true
      },
      zod4(pledgeSchema(event.locals.t, campaign.maxUnitsPerPledge))
    )
  };
};

export const actions: Actions = {
  pledge: async (event) => {
    let context: Awaited<ReturnType<typeof campaignContext>>;
    try {
      context = await campaignContext(event);
    } catch (cause) {
      if (isHttpError(cause) || isRedirect(cause)) throw cause;
      event.locals.logger.error({ err: cause }, 'load campaign pledge context failed');
      throw error(500);
    }

    const body = await event.request.formData();
    const publicValues = body.getAll('listPublicly');
    body.set('listPublicly', publicValues.at(-1) === 'true' ? 'true' : 'false');
    const form = await superValidate(
      body,
      zod4(pledgeSchema(event.locals.t, context.view.campaign.maxUnitsPerPledge))
    );
    if (!form.valid) return fail(400, { form });

    const gateway = getApp(context.config).stripe.payment;
    if (!gateway) {
      return message(form, event.locals.t('campaign.error.not_ready'), { status: 503 });
    }
    const statusUrl = `${context.config.auth.publicBaseUrl}/pledges/${pledgeAccessTokenPlaceholder}`;
    try {
      const result = await startPledgeCheckout(getDatabaseClient(context.config), gateway, {
        campaignId: context.view.campaign.id,
        userId: event.locals.session?.userId ?? null,
        displayName: form.data.displayName,
        listPublicly: form.data.listPublicly,
        unitCount: form.data.unitCount,
        successUrl: `${statusUrl}?payment=success`,
        cancelUrl: `${statusUrl}?payment=cancelled`
      });
      throw redirect(303, result.checkoutUrl);
    } catch (cause) {
      if (isHttpError(cause) || isRedirect(cause)) throw cause;
      if (cause instanceof CampaignError) {
        event.locals.logger.warn({ err: cause, code: cause.code }, 'campaign pledge rejected');
        if (cause.code === 'not_found') throw error(404);
        const key =
          cause.code === 'not_payable'
            ? 'campaign.error.not_payable'
            : cause.code === 'not_ready'
              ? 'campaign.error.not_ready'
              : cause.code === 'gateway'
                ? 'campaign.error.gateway'
                : 'campaign.error.validation';
        const status = cause.code === 'gateway' ? 503 : cause.code === 'validation' ? 400 : 409;
        return message(form, event.locals.t(key), { status });
      }
      event.locals.logger.error({ err: cause }, 'start campaign pledge failed');
      return message(form, event.locals.t('campaign.error.gateway'), { status: 500 });
    }
  }
};
