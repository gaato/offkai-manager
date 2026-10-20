import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DatabaseClient, DatabaseTransaction } from '$lib/server/db/client';
import { campaigns, orders, organizations, stripeConnectAccounts } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { roleAtLeast } from '$lib/shared/organization';
import { campaignOrderStatuses, type CampaignOrderStatus } from '$lib/shared/campaign';
import { CampaignError } from './errors';
import {
  campaignStatuses,
  type Campaign,
  type CampaignCapabilities,
  type CampaignForOrganization,
  type CampaignListForOrganization,
  type CampaignStatus,
  type ChangeCampaignStatusInput,
  type CreateCampaignInput,
  type PublicCampaign,
  type PublishCampaignCompletionReportInput,
  type UpdateCampaignSettingsInput
} from './types';

const campaignSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const freezeOrderStatuses = ['pending', 'payment_pending', 'paid'] as const;

/** Creates a draft campaign and its event-less audit row atomically. */
export async function createCampaign(
  client: DatabaseClient,
  input: CreateCampaignInput
): Promise<Campaign> {
  const values = validateCampaignSettings({
    ...input,
    description: input.description ?? '',
    maxUnitsPerPledge: input.maxUnitsPerPledge ?? 10,
    fulfillmentDate: input.fulfillmentDate ?? null,
    fulfillmentNote: input.fulfillmentNote ?? '',
    contact: input.contact ?? ''
  });

  try {
    return await client.db.transaction(async (tx) => {
      await authorizeOrganizationRole(tx, input.organizationId, input.actorUserId, 'organizer');
      const createdRows = await tx
        .insert(campaigns)
        .values({ ...values, organizationId: input.organizationId, status: 'draft' })
        .returning();
      const created = parseCampaign(createdRows[0]);
      await appendAudit(tx, {
        actorUserId: input.actorUserId,
        eventId: null,
        action: 'campaign.create',
        targetType: 'campaign',
        targetId: created.id,
        after: campaignAuditSnapshot(created)
      });
      return created;
    });
  } catch (cause) {
    if (isCampaignSlugCollision(cause)) {
      throw new CampaignError('conflict', 'campaign slug is already in use', { cause });
    }
    throw cause;
  }
}

/** Updates campaign settings while enforcing price/currency and slug freeze rules under lock. */
export async function updateCampaignSettings(
  client: DatabaseClient,
  input: UpdateCampaignSettingsInput
): Promise<Campaign> {
  const values = validateCampaignSettings(input);
  try {
    return await client.db.transaction(async (tx) => {
      const current = await loadCampaign(tx, input.campaignId, true);
      await authorizeOrganizationRole(tx, current.organizationId, input.actorUserId, 'organizer');
      if (current.status !== 'draft' && values.slug !== current.slug) {
        throw new CampaignError('settings_frozen', 'campaign slug is frozen outside draft');
      }
      if (values.currency !== current.currency) {
        // Every order is a retained ledger snapshot, and the composite FK pins that
        // snapshot to this currency even after the order expires or is cancelled.
        const existingOrders = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.campaignId, current.id))
          .limit(1);
        if (existingOrders[0]) {
          throw new CampaignError(
            'settings_frozen',
            'campaign currency is frozen after any order is created'
          );
        }
      }
      if (values.unitPriceMinor !== current.unitPriceMinor) {
        const activeOrders = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(eq(orders.campaignId, current.id), inArray(orders.status, freezeOrderStatuses))
          )
          .limit(1);
        if (activeOrders[0]) {
          throw new CampaignError(
            'settings_frozen',
            'campaign unit price is frozen after an order starts'
          );
        }
      }

      const updatedRows = await tx
        .update(campaigns)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(campaigns.id, current.id))
        .returning();
      const updated = parseCampaign(updatedRows[0]);
      await appendAudit(tx, {
        actorUserId: input.actorUserId,
        eventId: null,
        action: 'campaign.settings_update',
        targetType: 'campaign',
        targetId: updated.id,
        before: campaignAuditSnapshot(current),
        after: campaignAuditSnapshot(updated)
      });
      return updated;
    });
  } catch (cause) {
    if (isCampaignSlugCollision(cause)) {
      throw new CampaignError('conflict', 'campaign slug is already in use', { cause });
    }
    throw cause;
  }
}

/** Applies one legal campaign lifecycle transition and appends its audit row. */
export async function changeCampaignStatus(
  client: DatabaseClient,
  input: ChangeCampaignStatusInput
): Promise<Campaign> {
  const target = parseCampaignStatus(input.status);
  return client.db.transaction(async (tx) => {
    const current = await loadCampaign(tx, input.campaignId, true);
    await authorizeOrganizationRole(tx, current.organizationId, input.actorUserId, 'organizer');
    if (!canChangeCampaignStatus(current.status, target)) {
      throw new CampaignError(
        'illegal_transition',
        `campaign cannot transition from ${current.status} to ${target}`
      );
    }
    if (current.status === 'draft' && target === 'open' && !current.contact.trim()) {
      // The public pledge form must expose a request channel for the organizer's
      // legally required seller disclosure before the campaign can accept money.
      throw new CampaignError('validation', 'campaign contact is required before opening');
    }
    const updatedRows = await tx
      .update(campaigns)
      .set({ status: target, updatedAt: new Date() })
      .where(eq(campaigns.id, current.id))
      .returning();
    const updated = parseCampaign(updatedRows[0]);
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: null,
      action: 'campaign.status_change',
      targetType: 'campaign',
      targetId: updated.id,
      before: { status: current.status },
      after: { status: updated.status }
    });
    return updated;
  });
}

/** Publishes or replaces the supporter-facing fulfillment and expenditure report. */
export async function publishCampaignCompletionReport(
  client: DatabaseClient,
  input: PublishCampaignCompletionReportInput
): Promise<Campaign> {
  const text = input.text.trim();
  if (!text || text.length > 20_000) {
    throw new CampaignError('validation', 'completion report must be 1 to 20000 characters');
  }

  return client.db.transaction(async (tx) => {
    const current = await loadCampaign(tx, input.campaignId, true);
    await authorizeOrganizationRole(tx, current.organizationId, input.actorUserId, 'organizer');
    if (current.status !== 'closed' && current.status !== 'archived') {
      throw new CampaignError(
        'illegal_transition',
        'completion report is available only after a campaign closes'
      );
    }
    const reportedAt = new Date();
    const updatedRows = await tx
      .update(campaigns)
      .set({
        completionReportText: text,
        completionReportedAt: reportedAt,
        updatedAt: reportedAt
      })
      .where(eq(campaigns.id, current.id))
      .returning();
    const updated = parseCampaign(updatedRows[0]);
    await appendAudit(tx, {
      actorUserId: input.actorUserId,
      eventId: null,
      action: 'campaign.completion_report_publish',
      targetType: 'campaign',
      targetId: updated.id,
      before: {
        completionReportText: current.completionReportText,
        completionReportedAt: current.completionReportedAt?.toISOString() ?? null
      },
      after: {
        completionReportText: updated.completionReportText,
        completionReportedAt: updated.completionReportedAt?.toISOString() ?? null
      }
    });
    return updated;
  });
}

/** Loads a staff-authorized campaign dashboard with paid totals, freeze flags, and its ledger. */
export async function getCampaignForOrganization(
  client: DatabaseClient,
  actorUserId: string,
  campaignId: string
): Promise<CampaignForOrganization> {
  return client.db.transaction(async (tx) => {
    const campaign = await loadCampaign(tx, campaignId);
    const organization = await authorizeOrganizationRole(
      tx,
      campaign.organizationId,
      actorUserId,
      'staff',
      false,
      true
    );
    return {
      campaign,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      actorRole: organization.role,
      organizationSuspendedAt: organization.suspendedAt,
      ...campaignDashboard(await campaignOrderRows(tx, campaign.id)),
      ...campaignCapabilities(organization.role)
    };
  });
}

/** Lists staff-authorized campaign summaries with paid-only totals and capability flags. */
export async function listCampaignsForOrganization(
  client: DatabaseClient,
  actorUserId: string,
  organizationId: string
): Promise<CampaignListForOrganization> {
  return client.db.transaction(async (tx) => {
    const organization = await authorizeOrganizationRole(
      tx,
      organizationId,
      actorUserId,
      'staff',
      false,
      true
    );
    const rows = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.organizationId, organizationId))
      .orderBy(desc(campaigns.createdAt));
    const totals = rows.length
      ? await tx
          .select({
            campaignId: orders.campaignId,
            raisedMinor: sql<string>`coalesce(sum(${orders.amountMinor}) filter (where ${orders.status} = 'paid'), 0)::text`,
            paidOrderCount: sql<number>`count(*) filter (where ${orders.status} = 'paid')::int`
          })
          .from(orders)
          .where(
            inArray(
              orders.campaignId,
              rows.map((row) => row.id)
            )
          )
          .groupBy(orders.campaignId)
      : [];
    const totalsByCampaign = new Map(totals.map((row) => [row.campaignId, row]));
    return {
      campaigns: rows.map((row) => {
        const campaign = parseCampaign(row);
        const tally = totalsByCampaign.get(campaign.id);
        return {
          ...campaign,
          raisedMinor: BigInt(tally?.raisedMinor ?? '0'),
          paidOrderCount: tally?.paidOrderCount ?? 0
        };
      }),
      actorRole: organization.role,
      organizationSuspendedAt: organization.suspendedAt,
      ...campaignCapabilities(organization.role)
    };
  });
}

async function campaignOrderRows(tx: DatabaseTransaction, campaignId: string) {
  const rows = await tx
    .select({
      id: orders.id,
      displayName: orders.displayName,
      listPublicly: orders.listPublicly,
      unitCount: orders.unitCount,
      unitPriceMinor: orders.unitPriceMinor,
      amountMinor: orders.amountMinor,
      currency: orders.currency,
      status: orders.status,
      paidAt: orders.paidAt,
      userId: orders.userId,
      createdAt: orders.createdAt
    })
    .from(orders)
    .where(eq(orders.campaignId, campaignId))
    .orderBy(desc(orders.createdAt), desc(orders.id));
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    listPublicly: row.listPublicly,
    unitCount: row.unitCount,
    unitPriceMinor: row.unitPriceMinor,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: parseCampaignOrderStatus(row.status),
    paidAt: row.paidAt,
    linkedUser: row.userId !== null,
    createdAt: row.createdAt
  }));
}

function campaignDashboard(pledges: Awaited<ReturnType<typeof campaignOrderRows>>) {
  const paid = pledges.filter((pledge) => pledge.status === 'paid');
  return {
    raisedMinor: paid.reduce((total, pledge) => total + pledge.amountMinor, 0n),
    paidOrderCount: paid.length,
    priceFrozen: pledges.some((pledge) =>
      freezeOrderStatuses.includes(pledge.status as (typeof freezeOrderStatuses)[number])
    ),
    currencyFrozen: pledges.length > 0,
    pledges
  };
}

function parseCampaignOrderStatus(value: string): CampaignOrderStatus {
  if ((campaignOrderStatuses as readonly string[]).includes(value)) {
    return value as CampaignOrderStatus;
  }
  throw new CampaignError('validation', 'campaign pledge status is invalid');
}

/** Returns public paid-only campaign totals and the oldest 100 consenting supporters. */
export async function publicCampaignBySlug(
  client: DatabaseClient,
  rawOrganizationSlug: string,
  rawCampaignSlug: string
): Promise<PublicCampaign | null> {
  const organizationSlug = rawOrganizationSlug.trim();
  const campaignSlug = rawCampaignSlug.trim();
  if (!organizationSlug || !campaignSlug) return null;

  const rows = await client.db
    .select({
      campaign: campaigns,
      organizationName: organizations.name,
      connectStatus: stripeConnectAccounts.onboardingStatus,
      chargesEnabled: stripeConnectAccounts.chargesEnabled
    })
    .from(campaigns)
    .innerJoin(organizations, eq(organizations.id, campaigns.organizationId))
    .leftJoin(stripeConnectAccounts, eq(stripeConnectAccounts.organizationId, organizations.id))
    .where(
      and(
        eq(organizations.slug, organizationSlug),
        eq(campaigns.slug, campaignSlug),
        inArray(campaigns.status, ['open', 'closed']),
        isNull(organizations.suspendedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const identityVerified = row.connectStatus === 'ready' && row.chargesEnabled === true;

  const tallies = await client.sql<
    { raisedMinor: string; orderCount: number; publicSupporterCount: number }[]
  >`
    select
      coalesce(sum(amount_minor), 0)::text as "raisedMinor",
      count(*)::int as "orderCount",
      count(*) filter (where list_publicly)::int as "publicSupporterCount"
    from orders
    where campaign_id = ${row.campaign.id} and status = 'paid'
  `;
  const supporterRows = await client.db
    .select({
      displayName: orders.displayName,
      unitCount: orders.unitCount,
      amountMinor: orders.amountMinor,
      createdAt: orders.createdAt
    })
    .from(orders)
    .where(
      and(
        eq(orders.campaignId, row.campaign.id),
        eq(orders.status, 'paid'),
        eq(orders.listPublicly, true)
      )
    )
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(100);
  const tally = tallies[0];
  const publicCampaign = parseCampaign(row.campaign);
  return {
    campaign:
      publicCampaign.status === 'closed'
        ? publicCampaign
        : {
            ...publicCampaign,
            completionReportText: null,
            completionReportedAt: null
          },
    organizationName: row.organizationName,
    raisedMinor: BigInt(tally.raisedMinor),
    orderCount: tally.orderCount,
    supporters: supporterRows,
    supporterOverflowCount: Math.max(0, tally.publicSupporterCount - supporterRows.length),
    connectReady: identityVerified,
    identityVerified
  };
}

function campaignCapabilities(role: CampaignForOrganization['actorRole']): CampaignCapabilities {
  return {
    canManageCampaign: roleAtLeast(role, 'organizer'),
    canViewCampaignLedger: roleAtLeast(role, 'staff')
  };
}

function canChangeCampaignStatus(current: CampaignStatus, target: CampaignStatus): boolean {
  return (
    (current === 'draft' && target === 'open') ||
    (current === 'open' && (target === 'closed' || target === 'archived')) ||
    (current === 'closed' && (target === 'open' || target === 'archived'))
  );
}

async function loadCampaign(
  tx: DatabaseTransaction,
  campaignId: string,
  lock = false
): Promise<Campaign> {
  const query = tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  const rows = lock ? await query.for('update') : await query;
  if (!rows[0]) throw new CampaignError('not_found', 'campaign not found');
  return parseCampaign(rows[0]);
}

function parseCampaign(row: typeof campaigns.$inferSelect): Campaign {
  return { ...row, status: parseCampaignStatus(row.status) };
}

function parseCampaignStatus(value: unknown): CampaignStatus {
  if (typeof value === 'string' && (campaignStatuses as readonly string[]).includes(value)) {
    return value as CampaignStatus;
  }
  throw new CampaignError('validation', 'campaign status is invalid');
}

function validateCampaignSettings(input: {
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
}) {
  const title = input.title.trim();
  const slug = input.slug.trim();
  const currency = input.currency.trim().toUpperCase();
  if (!title || title.length > 200) {
    throw new CampaignError('validation', 'campaign title must be 1 to 200 characters');
  }
  if (!campaignSlugPattern.test(slug)) {
    throw new CampaignError('validation', 'campaign slug is invalid');
  }
  if (input.unitPriceMinor <= 0n) {
    throw new CampaignError('validation', 'campaign unit price must be positive');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new CampaignError('validation', 'campaign currency must be three letters');
  }
  if (input.goalMinor < 0n) {
    throw new CampaignError('validation', 'campaign goal cannot be negative');
  }
  if (
    !Number.isInteger(input.maxUnitsPerPledge) ||
    input.maxUnitsPerPledge < 1 ||
    input.maxUnitsPerPledge > 100
  ) {
    throw new CampaignError('validation', 'campaign maximum units must be 1 to 100');
  }
  const fulfillmentDate = input.fulfillmentDate?.trim() || null;
  if (fulfillmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(fulfillmentDate)) {
    throw new CampaignError('validation', 'campaign fulfillment date is invalid');
  }
  return {
    title,
    slug,
    description: input.description.trim(),
    unitPriceMinor: input.unitPriceMinor,
    currency,
    goalMinor: input.goalMinor,
    maxUnitsPerPledge: input.maxUnitsPerPledge,
    fulfillmentDate,
    fulfillmentNote: input.fulfillmentNote.trim(),
    contact: input.contact.trim()
  };
}

function campaignAuditSnapshot(campaign: Campaign) {
  return {
    title: campaign.title,
    slug: campaign.slug,
    description: campaign.description,
    unitPriceMinor: campaign.unitPriceMinor.toString(),
    currency: campaign.currency,
    goalMinor: campaign.goalMinor.toString(),
    maxUnitsPerPledge: campaign.maxUnitsPerPledge,
    fulfillmentDate: campaign.fulfillmentDate,
    fulfillmentNote: campaign.fulfillmentNote,
    contact: campaign.contact,
    completionReportText: campaign.completionReportText,
    completionReportedAt: campaign.completionReportedAt?.toISOString() ?? null,
    status: campaign.status
  };
}

function isCampaignSlugCollision(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const error = cause as { cause?: unknown; code?: unknown; constraint_name?: unknown };
  return (
    (error.code === '23505' && error.constraint_name === 'campaigns_organization_id_slug_key') ||
    isCampaignSlugCollision(error.cause)
  );
}
