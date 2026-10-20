import { error, fail, isRedirect, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  CampaignError,
  createCampaign,
  listCampaignsForOrganization
} from '$lib/server/domain/campaigns';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClock } from '$lib/server/time';
import { campaignStatusLabelKey } from '$lib/shared/campaign';
import { formatMoney } from '$lib/shared/money';

const campaignSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function campaignFormSchema(t: App.Locals['t']) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('form.validation_required'))
      .max(200, t('form.validation_too_long', { max: 200 })),
    slug: z.string().trim().regex(campaignSlugPattern, t('campaign_admin.validation.slug')),
    description: z.string().max(10_000, t('form.validation_too_long', { max: 10_000 })),
    unitPriceMinor: z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/, t('campaign_admin.validation.price')),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, t('campaign_admin.validation.currency')),
    goalMinor: z.string().trim().regex(/^\d+$/, t('campaign_admin.validation.goal')),
    maxUnitsPerPledge: z.preprocess(
      Number,
      z
        .number()
        .int()
        .min(1, t('campaign_admin.validation.max_units'))
        .max(100, t('campaign_admin.validation.max_units'))
    ),
    fulfillmentDate: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || calendarDatePattern.test(value),
        t('campaign_admin.validation.fulfillment_date')
      ),
    fulfillmentNote: z.string().max(5_000, t('form.validation_too_long', { max: 5_000 })),
    contact: z.string().max(500, t('form.validation_too_long', { max: 500 }))
  });
}

export const load: PageServerLoad = async (event) => {
  const session = requireSession(event);
  const organizationId = z.uuid().safeParse(event.params.orgId);
  if (!organizationId.success) throw error(404);
  try {
    const config = getConfig();
    const result = await listCampaignsForOrganization(
      getDatabaseClient(config),
      session.userId,
      organizationId.data
    );
    return {
      campaigns: result.campaigns.map((campaign) => ({
        id: campaign.id,
        title: campaign.title,
        statusLabel: event.locals.t(campaignStatusLabelKey(campaign.status)),
        unitPrice: formatMoney(campaign.unitPriceMinor, campaign.currency, event.locals.locale),
        raised: formatMoney(campaign.raisedMinor, campaign.currency, event.locals.locale),
        paidOrderCount: campaign.paidOrderCount,
        createdAt: formatWallClock(campaign.createdAt, event.locals.locale, config.time.zone, {
          dateStyle: 'medium'
        })
      })),
      canManageCampaign: result.canManageCampaign && !result.organizationSuspendedAt,
      form: await superValidate(
        {
          title: '',
          slug: '',
          description: '',
          unitPriceMinor: '',
          currency: 'JPY',
          goalMinor: '0',
          maxUnitsPerPledge: 10,
          fulfillmentDate: '',
          fulfillmentNote: '',
          contact: ''
        },
        zod4(campaignFormSchema(event.locals.t)),
        // The blank template intentionally fails validation; suppress the eager
        // errors or the client-side form starts invalid and never submits.
        { errors: false }
      )
    };
  } catch (cause) {
    if (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code)) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load organization campaigns failed');
    throw error(500);
  }
};

export const actions: Actions = {
  create: async (event) => {
    const session = requireSession(event);
    const organizationId = z.uuid().safeParse(event.params.orgId);
    if (!organizationId.success) throw error(404);
    const form = await superValidate(event, zod4(campaignFormSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    try {
      const campaign = await createCampaign(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        organizationId: organizationId.data,
        title: form.data.title,
        slug: form.data.slug,
        description: form.data.description,
        unitPriceMinor: BigInt(form.data.unitPriceMinor),
        currency: form.data.currency,
        goalMinor: BigInt(form.data.goalMinor),
        maxUnitsPerPledge: form.data.maxUnitsPerPledge,
        fulfillmentDate: form.data.fulfillmentDate || null,
        fulfillmentNote: form.data.fulfillmentNote,
        contact: form.data.contact
      });
      throw redirect(303, `/app/campaigns/${campaign.id}`);
    } catch (cause) {
      if (isRedirect(cause)) throw cause;
      event.locals.logger[
        cause instanceof CampaignError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'create campaign failed');
      const key =
        cause instanceof CampaignError && cause.code === 'conflict'
          ? 'campaign_admin.error.slug_conflict'
          : cause instanceof CampaignError && cause.code === 'validation'
            ? 'campaign_admin.error.validation'
            : cause instanceof OrganizationError && cause.code === 'forbidden'
              ? 'campaign_admin.error.forbidden'
              : 'campaign_admin.error.generic';
      const status =
        cause instanceof CampaignError && cause.code === 'conflict'
          ? 409
          : cause instanceof CampaignError && cause.code === 'validation'
            ? 400
            : cause instanceof OrganizationError && cause.code === 'forbidden'
              ? 403
              : 500;
      return message(form, event.locals.t(key), { status });
    }
  }
};
