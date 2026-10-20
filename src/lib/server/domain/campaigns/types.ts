import type { OrganizationRole } from '$lib/shared/organization';
import {
  campaignStatuses,
  type CampaignOrderStatus,
  type CampaignStatus
} from '$lib/shared/campaign';

export { campaignStatuses, type CampaignStatus };

export interface Campaign {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  description: string;
  unitPriceMinor: bigint;
  currency: string;
  goalMinor: bigint;
  maxUnitsPerPledge: number;
  fulfillmentDate: string | null;
  fulfillmentNote: string;
  contact: string;
  completionReportText: string | null;
  completionReportedAt: Date | null;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignCapabilities {
  canManageCampaign: boolean;
  canViewCampaignLedger: boolean;
}

export interface CampaignForOrganization extends CampaignCapabilities {
  campaign: Campaign;
  organizationName: string;
  organizationSlug: string;
  actorRole: OrganizationRole;
  organizationSuspendedAt: Date | null;
  raisedMinor: bigint;
  paidOrderCount: number;
  priceFrozen: boolean;
  currencyFrozen: boolean;
  pledges: CampaignPledgeLedgerRow[];
}

export interface CampaignSummary extends Campaign {
  raisedMinor: bigint;
  paidOrderCount: number;
}

export interface CampaignListForOrganization extends CampaignCapabilities {
  campaigns: CampaignSummary[];
  actorRole: OrganizationRole;
  organizationSuspendedAt: Date | null;
}

export interface CampaignPledgeLedgerRow {
  id: string;
  displayName: string;
  listPublicly: boolean;
  unitCount: number;
  unitPriceMinor: bigint;
  amountMinor: bigint;
  currency: string;
  status: CampaignOrderStatus;
  paidAt: Date | null;
  linkedUser: boolean;
  createdAt: Date;
}

export interface CreateCampaignInput {
  actorUserId: string;
  organizationId: string;
  title: string;
  slug: string;
  description?: string;
  unitPriceMinor: bigint;
  currency: string;
  goalMinor: bigint;
  maxUnitsPerPledge?: number;
  fulfillmentDate?: string | null;
  fulfillmentNote?: string;
  contact?: string;
}

export interface UpdateCampaignSettingsInput {
  actorUserId: string;
  campaignId: string;
  title: string;
  slug: string;
  description: string;
  unitPriceMinor: bigint;
  currency: string;
  goalMinor: bigint;
  maxUnitsPerPledge: number;
  fulfillmentDate: string | null;
  fulfillmentNote: string;
  contact: string;
}

export interface ChangeCampaignStatusInput {
  actorUserId: string;
  campaignId: string;
  status: CampaignStatus;
}

export interface PublishCampaignCompletionReportInput {
  actorUserId: string;
  campaignId: string;
  text: string;
}

export interface StartPledgeCheckoutInput {
  campaignId: string;
  userId?: string | null;
  displayName: string;
  listPublicly: boolean;
  unitCount: number;
  successUrl: string;
  cancelUrl: string;
}

export interface StartPledgeCheckoutResult {
  checkoutUrl: string;
  accessToken: string;
}

export interface PublicCampaignSupporter {
  displayName: string;
  unitCount: number;
  amountMinor: bigint;
  createdAt: Date;
}

export interface PublicCampaign {
  campaign: Campaign;
  organizationName: string;
  raisedMinor: bigint;
  orderCount: number;
  supporters: PublicCampaignSupporter[];
  supporterOverflowCount: number;
  connectReady: boolean;
  identityVerified: boolean;
}
