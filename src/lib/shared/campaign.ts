export const campaignStatuses = ['draft', 'open', 'closed', 'archived'] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];

export const campaignOrderStatuses = [
  'pending',
  'payment_pending',
  'paid',
  'expired',
  'cancelled'
] as const;
export type CampaignOrderStatus = (typeof campaignOrderStatuses)[number];

export function campaignStatusLabelKey(
  status: CampaignStatus
): `campaign_admin.status.${CampaignStatus}` {
  return `campaign_admin.status.${status}`;
}

export function campaignOrderStatusLabelKey(
  status: CampaignOrderStatus
): `campaign_admin.pledge_status.${CampaignOrderStatus}` {
  return `campaign_admin.pledge_status.${status}`;
}
