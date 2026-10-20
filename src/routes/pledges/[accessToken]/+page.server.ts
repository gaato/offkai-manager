import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getOrderByAccessToken, type OrderStatus } from '$lib/server/domain/orders';
import { formatWallClock } from '$lib/server/time';
import { formatMoney } from '$lib/shared/money';

function statusPresentation(
  status: OrderStatus,
  conflict: boolean,
  t: App.Locals['t']
): { label: string; detail: string; tone: 'neutral' | 'info' | 'success' | 'warning' } {
  if (conflict) {
    return {
      label: t('pledge.status.conflict'),
      detail: t('pledge.status_detail.conflict'),
      tone: 'warning'
    };
  }
  switch (status) {
    case 'pending':
      return {
        label: t('pledge.status.pending'),
        detail: t('pledge.status_detail.pending'),
        tone: 'neutral'
      };
    case 'payment_pending':
      return {
        label: t('pledge.status.payment_pending'),
        detail: t('pledge.status_detail.payment_pending'),
        tone: 'info'
      };
    case 'paid':
      return {
        label: t('pledge.status.paid'),
        detail: t('pledge.status_detail.paid'),
        tone: 'success'
      };
    case 'expired':
      return {
        label: t('pledge.status.expired'),
        detail: t('pledge.status_detail.expired'),
        tone: 'warning'
      };
    case 'cancelled':
      return {
        label: t('pledge.status.cancelled'),
        detail: t('pledge.status_detail.cancelled'),
        tone: 'warning'
      };
  }
}

export const load: PageServerLoad = async (event) => {
  event.setHeaders({
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex'
  });
  const token = event.params.accessToken;
  if (!token) throw error(404);
  const config = getConfig();
  const view = await getOrderByAccessToken(getDatabaseClient(config), token);
  if (!view) throw error(404);

  const conflict =
    view.order.paidAt !== null && ['expired', 'cancelled'].includes(view.order.status);
  const presentation = statusPresentation(view.order.status, conflict, event.locals.t);
  const payment = event.url.searchParams.get('payment');
  const abuseReportHref = config.platform.abuseReportEmail
    ? `mailto:${config.platform.abuseReportEmail}?subject=${encodeURIComponent(
        event.locals.t('campaign.abuse_subject', { slug: view.campaign.slug })
      )}`
    : null;
  return {
    campaignTitle: view.campaign.title,
    organizationName: view.campaign.organizationName,
    campaignHref: `/campaigns/${encodeURIComponent(view.campaign.organizationSlug)}/${encodeURIComponent(view.campaign.slug)}`,
    unitCount: view.order.unitCount,
    unitPrice: formatMoney(view.order.unitPriceMinor, view.order.currency, event.locals.locale),
    total: formatMoney(view.order.amountMinor, view.order.currency, event.locals.locale),
    statusLabel: presentation.label,
    statusDetail: presentation.detail,
    statusTone: presentation.tone,
    paidAt: view.order.paidAt
      ? formatWallClock(view.order.paidAt, event.locals.locale, config.time.zone)
      : '',
    resumeUnavailable: ['pending', 'payment_pending'].includes(view.order.status),
    paymentNotice: payment === 'success' || payment === 'cancelled' ? payment : null,
    abuseReportHref
  };
};
