export const orderStatuses = [
  'pending',
  'payment_pending',
  'paid',
  'expired',
  'cancelled'
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export interface Order {
  id: string;
  campaignId: string;
  userId: string | null;
  displayName: string;
  listPublicly: boolean;
  unitCount: number;
  unitPriceMinor: bigint;
  amountMinor: bigint;
  currency: string;
  status: OrderStatus;
  paidAt: Date | null;
  accessToken: string;
  stripeAccountId: string;
  checkoutSessionId: string;
  paymentIntentId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderCampaignContext {
  id: string;
  title: string;
  slug: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}

export interface OrderAccessView {
  order: Order;
  campaign: OrderCampaignContext;
}

export function parseOrderStatus(value: string): OrderStatus {
  if ((orderStatuses as readonly string[]).includes(value)) return value as OrderStatus;
  throw new Error(`unknown order status: ${value}`);
}
