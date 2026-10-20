import { translate, type Locale } from '$lib/i18n';
import type { CampaignForOrganization } from '$lib/server/domain/campaigns';
import { formatExportWallClock } from '$lib/server/time';
import { campaignOrderStatusLabelKey } from '$lib/shared/campaign';
import { encodeCSV } from '$lib/shared/csv';

export function buildCampaignPledgesCSV(
  data: CampaignForOrganization,
  locale: Locale,
  zone: string
): string {
  const rows = [
    [
      translate(locale, 'campaign_admin.csv.display_name'),
      translate(locale, 'campaign_admin.csv.units'),
      translate(locale, 'campaign_admin.csv.unit_price'),
      translate(locale, 'campaign_admin.csv.amount'),
      translate(locale, 'campaign_admin.csv.currency'),
      translate(locale, 'campaign_admin.csv.status'),
      translate(locale, 'campaign_admin.csv.paid_at'),
      translate(locale, 'campaign_admin.csv.account'),
      translate(locale, 'campaign_admin.csv.listing'),
      translate(locale, 'campaign_admin.csv.conflict'),
      translate(locale, 'campaign_admin.csv.created_at')
    ],
    ...data.pledges.map((pledge) => [
      pledge.displayName,
      String(pledge.unitCount),
      pledge.unitPriceMinor.toString(),
      pledge.amountMinor.toString(),
      pledge.currency,
      translate(locale, campaignOrderStatusLabelKey(pledge.status)),
      pledge.paidAt ? formatExportWallClock(pledge.paidAt, zone) : '',
      translate(
        locale,
        pledge.linkedUser ? 'campaign_admin.account.linked' : 'campaign_admin.account.guest'
      ),
      translate(
        locale,
        pledge.listPublicly ? 'campaign_admin.listing.listed' : 'campaign_admin.listing.not_listed'
      ),
      translate(
        locale,
        pledge.paidAt && ['expired', 'cancelled'].includes(pledge.status)
          ? 'campaign_admin.csv.yes'
          : 'campaign_admin.csv.no'
      ),
      formatExportWallClock(pledge.createdAt, zone)
    ])
  ];
  return `\uFEFF${encodeCSV(rows)}`;
}
