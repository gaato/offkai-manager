import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  auditLogs,
  organizationMemberships,
  organizations,
  orders,
  stripeConnectAccounts
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  CampaignError,
  changeCampaignStatus,
  createCampaign,
  getCampaignForOrganization,
  listCampaignsForOrganization,
  publishCampaignCompletionReport,
  publicCampaignBySlug,
  updateCampaignSettings,
  type Campaign,
  type CreateCampaignInput,
  type UpdateCampaignSettingsInput
} from '$lib/server/domain/campaigns';
import { generateOrderAccessToken, getOrderByAccessToken } from '$lib/server/domain/orders';
import { createOrganization, OrganizationError } from '$lib/server/domain/orgs';

describe('campaign and order domains', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let organizerId: string;
  let staffId: string;
  let viewerId: string;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'campaign-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    [ownerId, organizerId, staffId, viewerId] = await Promise.all([
      createUser('campaign-owner', 'Campaign Owner'),
      createUser('campaign-organizer', 'Campaign Organizer'),
      createUser('campaign-staff', 'Campaign Staff'),
      createUser('campaign-viewer', 'Campaign Viewer')
    ]);
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  it('enforces the viewer/staff/organizer/owner authorization and capability matrix', async () => {
    const organization = await organizationWithRoles('Authorization');
    const campaign = await createCampaign(client, campaignInput(organization.id, ownerId, 'auth'));

    await expect(getCampaignForOrganization(client, viewerId, campaign.id)).rejects.toMatchObject({
      code: 'forbidden'
    } satisfies Partial<OrganizationError>);
    await expect(
      listCampaignsForOrganization(client, viewerId, organization.id)
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);

    const staffAccess = await getCampaignForOrganization(client, staffId, campaign.id);
    expect(staffAccess).toMatchObject({
      actorRole: 'staff',
      canManageCampaign: false,
      canViewCampaignLedger: true
    });
    const organizerAccess = await getCampaignForOrganization(client, organizerId, campaign.id);
    expect(organizerAccess).toMatchObject({
      actorRole: 'organizer',
      canManageCampaign: true,
      canViewCampaignLedger: true
    });
    const ownerAccess = await listCampaignsForOrganization(client, ownerId, organization.id);
    expect(ownerAccess).toMatchObject({
      actorRole: 'owner',
      canManageCampaign: true,
      canViewCampaignLedger: true
    });
    expect(ownerAccess.campaigns.map(({ id }) => id)).toContain(campaign.id);

    await expect(
      updateCampaignSettings(client, settingsInput(campaign, viewerId))
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
    await expect(
      updateCampaignSettings(client, settingsInput(campaign, staffId))
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
    await expect(
      createCampaign(client, campaignInput(organization.id, staffId, 'staff-denied'))
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
    await expect(
      createCampaign(client, campaignInput(organization.id, viewerId, 'viewer-denied'))
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);

    await expect(
      updateCampaignSettings(client, settingsInput(campaign, organizerId, { title: 'Organizer' }))
    ).resolves.toMatchObject({ title: 'Organizer' });
    await expect(
      updateCampaignSettings(client, settingsInput(campaign, ownerId, { title: 'Owner' }))
    ).resolves.toMatchObject({ title: 'Owner' });
    await expect(
      createCampaign(client, campaignInput(organization.id, organizerId, 'organizer-allowed'))
    ).resolves.toMatchObject({ status: 'draft' });
  });

  it('keeps campaign slugs unique per organization and normalizes currency', async () => {
    const firstOrganization = await organizationWithRoles('Slug One');
    const secondOrganization = await organizationWithRoles('Slug Two');
    const created = await createCampaign(
      client,
      campaignInput(firstOrganization.id, ownerId, 'shared-slug', { currency: 'jpy' })
    );
    expect(created.currency).toBe('JPY');
    await expect(
      createCampaign(client, campaignInput(firstOrganization.id, ownerId, 'shared-slug'))
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<CampaignError>);
    await expect(
      createCampaign(client, campaignInput(secondOrganization.id, ownerId, 'shared-slug'))
    ).resolves.toMatchObject({ slug: 'shared-slug' });
  });

  it('freezes price after active orders, currency after any order, and slug outside draft', async () => {
    const organization = await organizationWithRoles('Freeze');
    const campaign = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'freeze-rules')
    );
    await insertOrder(campaign, {
      status: 'pending',
      displayName: 'Pending supporter'
    });

    await expect(
      updateCampaignSettings(client, settingsInput(campaign, ownerId, { unitPriceMinor: 2_000n }))
    ).rejects.toMatchObject({ code: 'settings_frozen' } satisfies Partial<CampaignError>);
    await expect(
      updateCampaignSettings(client, settingsInput(campaign, ownerId, { currency: 'USD' }))
    ).rejects.toMatchObject({ code: 'settings_frozen' } satisfies Partial<CampaignError>);
    const editable = await updateCampaignSettings(
      client,
      settingsInput(campaign, ownerId, {
        title: 'Still editable',
        goalMinor: 99_000n,
        maxUnitsPerPledge: 42
      })
    );
    expect(editable).toMatchObject({
      title: 'Still editable',
      goalMinor: 99_000n,
      maxUnitsPerPledge: 42
    });

    const opened = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: campaign.id,
      status: 'open'
    });
    await expect(
      updateCampaignSettings(client, settingsInput(opened, ownerId, { slug: 'new-slug' }))
    ).rejects.toMatchObject({ code: 'settings_frozen' } satisfies Partial<CampaignError>);

    const expiredOnly = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'expired-does-not-freeze')
    );
    await insertOrder(expiredOnly, { status: 'expired', displayName: 'Expired supporter' });
    const repriced = await updateCampaignSettings(
      client,
      settingsInput(expiredOnly, ownerId, { unitPriceMinor: 2_500n })
    );
    expect(repriced).toMatchObject({ unitPriceMinor: 2_500n, currency: 'JPY' });
    await expect(
      updateCampaignSettings(client, settingsInput(repriced, ownerId, { currency: 'USD' }))
    ).rejects.toMatchObject({ code: 'settings_frozen' } satisfies Partial<CampaignError>);
  });

  it('accepts only the specified campaign status transitions and audits without an event', async () => {
    const organization = await organizationWithRoles('Transitions');
    const illegalDraft = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'illegal-draft')
    );
    await expect(
      changeCampaignStatus(client, {
        actorUserId: ownerId,
        campaignId: illegalDraft.id,
        status: 'closed'
      })
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<CampaignError>);

    const campaign = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'legal-transitions')
    );
    const opened = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: campaign.id,
      status: 'open'
    });
    const closed = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: opened.id,
      status: 'closed'
    });
    const reopened = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: closed.id,
      status: 'open'
    });
    const archived = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: reopened.id,
      status: 'archived'
    });
    expect(archived.status).toBe('archived');
    await expect(
      changeCampaignStatus(client, {
        actorUserId: ownerId,
        campaignId: archived.id,
        status: 'open'
      })
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<CampaignError>);

    const logs = await client.db
      .select({ action: auditLogs.action, eventId: auditLogs.eventId })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, 'campaign'), eq(auditLogs.targetId, campaign.id)))
      .orderBy(asc(auditLogs.createdAt));
    expect(logs.map(({ action }) => action)).toEqual([
      'campaign.create',
      'campaign.status_change',
      'campaign.status_change',
      'campaign.status_change',
      'campaign.status_change'
    ]);
    expect(logs.every(({ eventId }) => eventId === null)).toBe(true);
  });

  it('refuses to open a campaign without a disclosure contact', async () => {
    const organization = await organizationWithRoles('Contact Required');
    const campaign = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'contact-required', { contact: '' })
    );

    await expect(
      changeCampaignStatus(client, {
        actorUserId: ownerId,
        campaignId: campaign.id,
        status: 'open'
      })
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<CampaignError>);
    await expect(getCampaignForOrganization(client, ownerId, campaign.id)).resolves.toMatchObject({
      campaign: { status: 'draft', contact: '' }
    });
  });

  it('publishes completion reports only after intake and only for organizers', async () => {
    const organization = await organizationWithRoles('Completion Report');
    const draft = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'completion-report')
    );

    await expect(
      publishCampaignCompletionReport(client, {
        actorUserId: ownerId,
        campaignId: draft.id,
        text: 'Too early'
      })
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<CampaignError>);
    const opened = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: draft.id,
      status: 'open'
    });
    await expect(
      publishCampaignCompletionReport(client, {
        actorUserId: staffId,
        campaignId: opened.id,
        text: 'Staff cannot publish this.'
      })
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
    const closed = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: opened.id,
      status: 'closed'
    });
    await expect(
      publishCampaignCompletionReport(client, {
        actorUserId: organizerId,
        campaignId: closed.id,
        text: '   '
      })
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<CampaignError>);
    await expect(
      publishCampaignCompletionReport(client, {
        actorUserId: organizerId,
        campaignId: closed.id,
        text: 'x'.repeat(20_001)
      })
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<CampaignError>);
    const first = await publishCampaignCompletionReport(client, {
      actorUserId: organizerId,
      campaignId: closed.id,
      text: '  The display was delivered. Flowers cost ¥8,000.  '
    });
    expect(first.completionReportText).toBe('The display was delivered. Flowers cost ¥8,000.');
    expect(first.completionReportedAt).toBeInstanceOf(Date);
    expect(
      (await publicCampaignBySlug(client, organization.slug, closed.slug))?.campaign
        .completionReportText
    ).toBe(first.completionReportText);

    await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: closed.id,
      status: 'open'
    });
    expect(
      (await publicCampaignBySlug(client, organization.slug, closed.slug))?.campaign
        .completionReportText
    ).toBeNull();
    await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: closed.id,
      status: 'closed'
    });

    const replaced = await publishCampaignCompletionReport(client, {
      actorUserId: ownerId,
      campaignId: closed.id,
      text: 'Updated fulfillment result and spending breakdown.'
    });
    expect(replaced.completionReportText).toBe(
      'Updated fulfillment result and spending breakdown.'
    );
    expect(replaced.completionReportedAt!.getTime()).toBeGreaterThanOrEqual(
      first.completionReportedAt!.getTime()
    );

    const archived = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: closed.id,
      status: 'archived'
    });
    await expect(
      publishCampaignCompletionReport(client, {
        actorUserId: ownerId,
        campaignId: archived.id,
        text: 'Stored report correction.'
      })
    ).resolves.toMatchObject({ completionReportText: 'Stored report correction.' });
    expect(await publicCampaignBySlug(client, organization.slug, archived.slug)).toBeNull();

    const logs = await client.db
      .select({ action: auditLogs.action, eventId: auditLogs.eventId })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'campaign'),
          eq(auditLogs.targetId, archived.id),
          eq(auditLogs.action, 'campaign.completion_report_publish')
        )
      );
    expect(logs).toHaveLength(3);
    expect(logs.every(({ eventId }) => eventId === null)).toBe(true);
  });

  it('shows paid-only public totals, consenting supporters, and cap overflow', async () => {
    const organization = await organizationWithRoles('Public');
    const draft = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'public-campaign')
    );
    expect(await publicCampaignBySlug(client, organization.slug, draft.slug)).toBeNull();
    const opened = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: draft.id,
      status: 'open'
    });
    await client.db.insert(stripeConnectAccounts).values({
      organizationId: organization.id,
      stripeAccountId: `acct_public_${sequence}`,
      dashboardType: 'express',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: 'ready',
      country: 'JP',
      defaultCurrency: 'jpy'
    });

    await client.db.insert(orders).values([
      ...Array.from({ length: 101 }, (_, index) => ({
        campaignId: opened.id,
        displayName: `Public Supporter ${index}`,
        listPublicly: true,
        unitCount: 1,
        unitPriceMinor: 100n,
        amountMinor: 100n,
        currency: opened.currency,
        status: 'paid',
        paidAt: new Date(`2026-01-01T00:${String(index % 60).padStart(2, '0')}:00Z`),
        accessToken: generateOrderAccessToken(),
        createdAt: new Date(1_700_000_000_000 + index)
      })),
      {
        campaignId: opened.id,
        displayName: 'Private Supporter',
        listPublicly: false,
        unitCount: 2,
        unitPriceMinor: 100n,
        amountMinor: 200n,
        currency: opened.currency,
        status: 'paid',
        paidAt: new Date(),
        accessToken: generateOrderAccessToken(),
        createdAt: new Date(1_700_000_001_000)
      },
      {
        campaignId: opened.id,
        displayName: 'Pending Supporter',
        listPublicly: true,
        unitCount: 5,
        unitPriceMinor: 100n,
        amountMinor: 500n,
        currency: opened.currency,
        status: 'pending',
        accessToken: generateOrderAccessToken()
      },
      {
        campaignId: opened.id,
        displayName: 'Expired Supporter',
        listPublicly: true,
        unitCount: 5,
        unitPriceMinor: 100n,
        amountMinor: 500n,
        currency: opened.currency,
        status: 'expired',
        accessToken: generateOrderAccessToken()
      }
    ]);

    const publicView = await publicCampaignBySlug(client, organization.slug, opened.slug);
    expect(publicView).toMatchObject({
      organizationName: organization.name,
      raisedMinor: 10_300n,
      orderCount: 102,
      supporterOverflowCount: 1,
      connectReady: true,
      identityVerified: true
    });
    expect(publicView?.supporters).toHaveLength(100);
    expect(publicView?.supporters[0].displayName).toBe('Public Supporter 0');
    expect(
      publicView?.supporters.some(({ displayName }) => displayName === 'Private Supporter')
    ).toBe(false);

    const closed = await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: opened.id,
      status: 'closed'
    });
    expect(await publicCampaignBySlug(client, organization.slug, closed.slug)).not.toBeNull();
    await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: closed.id,
      status: 'archived'
    });
    expect(await publicCampaignBySlug(client, organization.slug, closed.slug)).toBeNull();
  });

  it('hides public campaigns owned by suspended organizations', async () => {
    const organization = await organizationWithRoles('Suspended Public');
    const campaign = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'suspended-public')
    );
    await changeCampaignStatus(client, {
      actorUserId: ownerId,
      campaignId: campaign.id,
      status: 'open'
    });
    await client.db
      .update(organizations)
      .set({ suspendedAt: new Date() })
      .where(eq(organizations.id, organization.id));
    expect(await publicCampaignBySlug(client, organization.slug, campaign.slug)).toBeNull();
  });

  it('generates 256-bit tokens and resolves order plus campaign context by bearer token', async () => {
    const organization = await organizationWithRoles('Access Token');
    const campaign = await createCampaign(
      client,
      campaignInput(organization.id, ownerId, 'access-token')
    );
    const token = generateOrderAccessToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const order = await insertOrder(campaign, {
      accessToken: token,
      status: 'payment_pending',
      checkoutSessionId: 'cs_access_token',
      displayName: 'Bearer Holder'
    });

    const found = await getOrderByAccessToken(client, token);
    expect(found?.order).toMatchObject({ id: order.id, status: 'payment_pending' });
    expect(found?.campaign).toEqual({
      id: campaign.id,
      title: campaign.title,
      slug: campaign.slug,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug
    });
    await expect(getOrderByAccessToken(client, 'missing-token')).resolves.toBeNull();
  });

  async function organizationWithRoles(prefix: string) {
    sequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `${prefix} ${sequence}`
    });
    await client.db.insert(organizationMemberships).values([
      { organizationId: organization.id, userId: organizerId, role: 'organizer' },
      { organizationId: organization.id, userId: staffId, role: 'staff' },
      { organizationId: organization.id, userId: viewerId, role: 'viewer' }
    ]);
    return organization;
  }

  async function createUser(providerUserId: string, displayName: string): Promise<string> {
    return (
      await upsertDiscordIdentity(client, {
        providerUserId,
        username: providerUserId,
        displayName,
        avatarUrl: ''
      })
    ).userId;
  }

  function campaignInput(
    organizationId: string,
    actorUserId: string,
    slug: string,
    overrides: Partial<CreateCampaignInput> = {}
  ): CreateCampaignInput {
    return {
      actorUserId,
      organizationId,
      title: `Campaign ${slug}`,
      slug,
      description: 'Campaign description',
      unitPriceMinor: 1_000n,
      currency: 'JPY',
      goalMinor: 50_000n,
      maxUnitsPerPledge: 10,
      fulfillmentDate: '2027-01-31',
      fulfillmentNote: 'Ships in winter',
      contact: '@organizer',
      ...overrides
    };
  }

  function settingsInput(
    campaign: Campaign,
    actorUserId: string,
    overrides: Partial<UpdateCampaignSettingsInput> = {}
  ): UpdateCampaignSettingsInput {
    return {
      actorUserId,
      campaignId: campaign.id,
      title: campaign.title,
      slug: campaign.slug,
      description: campaign.description,
      unitPriceMinor: campaign.unitPriceMinor,
      currency: campaign.currency,
      goalMinor: campaign.goalMinor,
      maxUnitsPerPledge: campaign.maxUnitsPerPledge,
      fulfillmentDate: campaign.fulfillmentDate,
      fulfillmentNote: campaign.fulfillmentNote,
      contact: campaign.contact,
      ...overrides
    };
  }

  async function insertOrder(
    campaign: Campaign,
    overrides: Partial<typeof orders.$inferInsert> = {}
  ) {
    const rows = await client.db
      .insert(orders)
      .values({
        campaignId: campaign.id,
        displayName: 'Supporter',
        listPublicly: false,
        unitCount: 1,
        unitPriceMinor: campaign.unitPriceMinor,
        amountMinor: campaign.unitPriceMinor,
        currency: campaign.currency,
        status: 'pending',
        accessToken: generateOrderAccessToken(),
        ...overrides
      })
      .returning();
    return rows[0];
  }
});
