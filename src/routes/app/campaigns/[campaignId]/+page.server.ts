import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  CampaignError,
  changeCampaignStatus,
  getCampaignForOrganization,
  publishCampaignCompletionReport,
  updateCampaignSettings
} from '$lib/server/domain/campaigns';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClock } from '$lib/server/time';
import { campaignOrderStatusLabelKey, campaignStatusLabelKey } from '$lib/shared/campaign';
import { formatMoney } from '$lib/shared/money';

const campaignSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function settingsSchema(t: App.Locals['t']) {
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

const statusSchema = z.object({ target: z.enum(['open', 'closed', 'archived']) });

function completionReportSchema(t: App.Locals['t']) {
  return z.object({
    text: z
      .string()
      .trim()
      .min(1, t('campaign_admin.report.validation_required'))
      .max(20_000, t('campaign_admin.report.validation_length'))
  });
}

export const load: PageServerLoad = async (event) => {
  const session = requireSession(event);
  const campaignId = routeCampaignId(event);
  try {
    const config = getConfig();
    const access = await getCampaignForOrganization(
      getDatabaseClient(config),
      session.userId,
      campaignId
    );
    const campaign = access.campaign;
    const publicPath = `/campaigns/${encodeURIComponent(access.organizationSlug)}/${encodeURIComponent(campaign.slug)}`;
    return {
      campaign,
      organizationName: access.organizationName,
      statusLabel: event.locals.t(campaignStatusLabelKey(campaign.status)),
      publicPath,
      shareUrl: new URL(publicPath, config.auth.publicBaseUrl).toString(),
      canManageCampaign: access.canManageCampaign && !access.organizationSuspendedAt,
      canViewCampaignLedger: access.canViewCampaignLedger,
      organizationSuspended: access.organizationSuspendedAt !== null,
      priceFrozen: access.priceFrozen,
      currencyFrozen: access.currencyFrozen,
      metrics: {
        raised: formatMoney(access.raisedMinor, campaign.currency, event.locals.locale),
        completed: access.paidOrderCount,
        goal: formatMoney(campaign.goalMinor, campaign.currency, event.locals.locale),
        unitPrice: formatMoney(campaign.unitPriceMinor, campaign.currency, event.locals.locale)
      },
      pledges: access.pledges.map((pledge) => ({
        id: pledge.id,
        displayName: pledge.displayName,
        unitCount: pledge.unitCount,
        amount: formatMoney(pledge.amountMinor, pledge.currency, event.locals.locale),
        statusLabel: event.locals.t(campaignOrderStatusLabelKey(pledge.status)),
        paidAt: pledge.paidAt
          ? formatWallClock(pledge.paidAt, event.locals.locale, config.time.zone)
          : event.locals.t('campaign_admin.not_available'),
        accountLabel: event.locals.t(
          pledge.linkedUser ? 'campaign_admin.account.linked' : 'campaign_admin.account.guest'
        ),
        listingLabel: event.locals.t(
          pledge.listPublicly
            ? 'campaign_admin.listing.listed'
            : 'campaign_admin.listing.not_listed'
        ),
        conflict: Boolean(pledge.paidAt && ['expired', 'cancelled'].includes(pledge.status))
      })),
      reportForm: await superValidate(
        { text: campaign.completionReportText ?? '' },
        zod4(completionReportSchema(event.locals.t)),
        { errors: false }
      ),
      form: await superValidate(
        {
          title: campaign.title,
          slug: campaign.slug,
          description: campaign.description,
          unitPriceMinor: campaign.unitPriceMinor.toString(),
          currency: campaign.currency,
          goalMinor: campaign.goalMinor.toString(),
          maxUnitsPerPledge: campaign.maxUnitsPerPledge,
          fulfillmentDate: campaign.fulfillmentDate ?? '',
          fulfillmentNote: campaign.fulfillmentNote,
          contact: campaign.contact
        },
        zod4(settingsSchema(event.locals.t))
      )
    };
  } catch (cause) {
    if (
      (cause instanceof CampaignError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load campaign workspace failed');
    throw error(500);
  }
};

export const actions: Actions = {
  settings: async (event) => {
    const session = requireSession(event);
    const campaignId = routeCampaignId(event);
    const form = await superValidate(event, zod4(settingsSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    try {
      await updateCampaignSettings(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        campaignId,
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
      return message(form, event.locals.t('campaign_admin.settings.success'));
    } catch (cause) {
      logCampaignFailure(event, cause, 'update campaign settings failed');
      return message(form, campaignErrorMessage(event, cause), {
        status: campaignErrorStatus(cause)
      });
    }
  },
  status: async (event) => {
    const session = requireSession(event);
    const campaignId = routeCampaignId(event);
    const parsed = statusSchema.safeParse(Object.fromEntries(await event.request.formData()));
    if (!parsed.success) {
      return fail(400, { actionError: event.locals.t('campaign_admin.error.validation') });
    }
    try {
      await changeCampaignStatus(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        campaignId,
        status: parsed.data.target
      });
      return { actionMessage: event.locals.t(statusSuccessKey(parsed.data.target)) };
    } catch (cause) {
      logCampaignFailure(event, cause, 'change campaign status failed');
      return fail(campaignErrorStatus(cause), {
        actionError:
          cause instanceof CampaignError && cause.code === 'validation'
            ? event.locals.t('campaign_admin.error.contact_required_to_open')
            : campaignErrorMessage(event, cause)
      });
    }
  },
  report: async (event) => {
    const session = requireSession(event);
    const campaignId = routeCampaignId(event);
    const form = await superValidate(event, zod4(completionReportSchema(event.locals.t)));
    if (!form.valid) return fail(400, { reportForm: form });
    try {
      await publishCampaignCompletionReport(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        campaignId,
        text: form.data.text
      });
      return message(form, event.locals.t('campaign_admin.report.success'));
    } catch (cause) {
      logCampaignFailure(event, cause, 'publish campaign completion report failed');
      const reportMessage =
        cause instanceof CampaignError && cause.code === 'illegal_transition'
          ? event.locals.t('campaign_admin.report.error_unavailable')
          : campaignErrorMessage(event, cause);
      return message(form, reportMessage, { status: campaignErrorStatus(cause) });
    }
  }
};

function routeCampaignId(event: RequestEvent): string {
  const campaignId = z.uuid().safeParse(event.params.campaignId);
  if (!campaignId.success) throw error(404);
  return campaignId.data;
}

function statusSuccessKey(target: 'open' | 'closed' | 'archived') {
  return target === 'open'
    ? 'campaign_admin.status_success.open'
    : target === 'closed'
      ? 'campaign_admin.status_success.closed'
      : 'campaign_admin.status_success.archived';
}

function campaignErrorMessage(event: RequestEvent, cause: unknown): string {
  const key =
    cause instanceof CampaignError && cause.code === 'settings_frozen'
      ? 'campaign_admin.error.settings_frozen'
      : cause instanceof CampaignError && cause.code === 'illegal_transition'
        ? 'campaign_admin.error.illegal_transition'
        : cause instanceof CampaignError && cause.code === 'conflict'
          ? 'campaign_admin.error.slug_conflict'
          : cause instanceof CampaignError && cause.code === 'validation'
            ? 'campaign_admin.error.validation'
            : cause instanceof OrganizationError && cause.code === 'forbidden'
              ? 'campaign_admin.error.forbidden'
              : 'campaign_admin.error.generic';
  return event.locals.t(key);
}

function campaignErrorStatus(cause: unknown): 400 | 403 | 409 | 500 {
  if (cause instanceof CampaignError && cause.code === 'validation') return 400;
  if (
    cause instanceof CampaignError &&
    ['settings_frozen', 'illegal_transition', 'conflict'].includes(cause.code)
  ) {
    return 409;
  }
  if (cause instanceof OrganizationError && cause.code === 'forbidden') return 403;
  return 500;
}

function logCampaignFailure(event: RequestEvent, cause: unknown, operation: string): void {
  event.locals.logger[
    cause instanceof CampaignError || cause instanceof OrganizationError ? 'warn' : 'error'
  ]({ err: cause }, operation);
}
