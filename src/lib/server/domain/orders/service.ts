import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { campaigns, orders, organizations } from '$lib/server/db/schema';
import { parseOrderRow } from './row';
import type { OrderAccessView } from './types';

/** Loads an order by its unguessable bearer token; no separate user authorization applies. */
export async function getOrderByAccessToken(
  client: DatabaseClient,
  rawAccessToken: string
): Promise<OrderAccessView | null> {
  const accessToken = rawAccessToken.trim();
  if (!accessToken) return null;

  const rows = await client.db
    .select({
      order: orders,
      campaignId: campaigns.id,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug
    })
    .from(orders)
    .innerJoin(campaigns, eq(campaigns.id, orders.campaignId))
    .innerJoin(organizations, eq(organizations.id, campaigns.organizationId))
    .where(eq(orders.accessToken, accessToken))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    order: parseOrderRow(row.order),
    campaign: {
      id: row.campaignId,
      title: row.campaignTitle,
      slug: row.campaignSlug,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      organizationSlug: row.organizationSlug
    }
  };
}
