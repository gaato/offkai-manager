import { and, eq } from 'drizzle-orm';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient } from '$lib/server/db/client';
import {
  organizations,
  externalAccounts,
  collectionPaymentMethods,
  eventDiscordIntegrations,
  events,
  orders,
  paymentRequests,
  registrationFormAnswers,
  registrations,
  stripeConnectAccounts,
  users
} from '$lib/server/db/schema';
import { runMigrations } from '$lib/server/db/migrate';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  archiveEvent,
  archiveField,
  cancelEvent,
  createEvent,
  publishEvent,
  toggleEventUnlisted,
  updateSettings,
  upsertField
} from '$lib/server/domain/events';
import { createOrganization, inviteMember } from '$lib/server/domain/orgs';
import {
  changeCampaignStatus,
  createCampaign,
  publishCampaignCompletionReport
} from '$lib/server/domain/campaigns';
import {
  confirmManualPayment,
  createCollection,
  markConflictRefunded,
  openCollection,
  settleCheckout
} from '$lib/server/domain/payments';
import { changeRegistrationStatus } from '$lib/server/domain/registrations';
import {
  campaignFixtures,
  devStripeOrganizations,
  e2eUsers,
  participantFixtures,
  opsJourney,
  paymentEventFixtures,
  paymentJourney,
  stripeSweepFixtures,
  suspendedUserFixture
} from './fixtures';

export async function seedE2E(databaseUrl: string): Promise<void> {
  const client = createDatabaseClient(
    loadConfig({
      OFFKAI_DATABASE_URL: databaseUrl,
      OFFKAI_SESSION_SECRET: 'e2e-development-session-secret',
      OFFKAI_AUTH_DEV_BYPASS: 'true'
    })
  );
  try {
    await runMigrations(client);
    const sweepOwner = await upsertDiscordIdentity(client, {
      providerUserId: e2eUsers.sweepOwner,
      username: 'sweep-owner',
      displayName: 'Sweep Owner',
      avatarUrl: ''
    });
    await upsertDiscordIdentity(client, {
      providerUserId: e2eUsers.organizer,
      username: 'organizer-scenario',
      displayName: 'Organizer Scenario',
      avatarUrl: ''
    });
    await client.db.insert(users).values({
      id: suspendedUserFixture.userId,
      suspendedAt: new Date('2026-07-01T00:00:00Z')
    });
    await client.db.insert(externalAccounts).values({
      userId: suspendedUserFixture.userId,
      provider: 'discord',
      providerUserId: suspendedUserFixture.discordUserId,
      username: 'suspended-user',
      displayName: suspendedUserFixture.displayName,
      avatarUrl: ''
    });
    await upsertDiscordIdentity(client, {
      providerUserId: e2eUsers.inviteTarget,
      username: 'invited-member',
      displayName: 'Invited Member',
      avatarUrl: ''
    });
    const paymentOrganizer = await upsertDiscordIdentity(client, {
      providerUserId: e2eUsers.paymentOrganizer,
      username: 'payment-organizer',
      displayName: 'Payment Organizer',
      avatarUrl: ''
    });
    const organization = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: 'Sweep Workspace'
    });
    await inviteMember(client, {
      actorUserId: sweepOwner.userId,
      organizationId: organization.id,
      discordUserId: e2eUsers.inviteTarget,
      role: 'viewer'
    });
    await inviteMember(client, {
      actorUserId: sweepOwner.userId,
      organizationId: organization.id,
      discordUserId: e2eUsers.organizer,
      role: 'organizer'
    });
    const opsOrganization = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: opsJourney.organizationName
    });
    const opsEvent = await createEvent(
      client,
      {
        actorUserId: sweepOwner.userId,
        organizationId: opsOrganization.id,
        title: opsJourney.eventTitle,
        startsAt: '2027-11-15T18:00',
        capacity: 30,
        registrationMode: 'auto_confirm',
        timeZone: 'Asia/Tokyo'
      },
      () => opsJourney.eventSlug
    );
    await updateSettings(client, {
      actorUserId: sweepOwner.userId,
      eventId: opsEvent.id,
      title: opsJourney.eventTitle,
      description: 'A dedicated fixture for the platform suspension journey.',
      startsAt: '2027-11-15T18:00',
      endsAt: '2027-11-15T21:00',
      capacity: 30,
      venueName: 'Operations Hall',
      venueAddress: '',
      venueReveal: 'public',
      contact: 'ops@example.test',
      cancellationPolicy: '',
      registrationOpensAt: '2026-01-01T00:00',
      registrationClosesAt: '2027-11-15T17:00',
      registrationMode: 'auto_confirm',
      discordPolicy: 'not_used',
      timeZone: 'Asia/Tokyo'
    });
    await publishEvent(client, { actorUserId: sweepOwner.userId, eventId: opsEvent.id });
    for (const [index, fixture] of stripeSweepFixtures.entries()) {
      const stateOrganization = await createOrganization(client, {
        actorUserId: sweepOwner.userId,
        name: fixture.organizationName
      });
      if (fixture.status === 'not_connected') continue;
      const detailsSubmitted = ['pending_verification', 'ready'].includes(fixture.status);
      const ready = fixture.status === 'ready';
      await client.db.insert(stripeConnectAccounts).values({
        organizationId: stateOrganization.id,
        stripeAccountId: `acct_sweep_${index + 1}`,
        dashboardType: 'express',
        chargesEnabled: ready,
        payoutsEnabled: ready,
        detailsSubmitted,
        onboardingStatus: fixture.status,
        country: 'JP',
        defaultCurrency: 'jpy'
      });
    }
    for (const name of Object.values(devStripeOrganizations)) {
      await createOrganization(client, { actorUserId: sweepOwner.userId, name });
    }
    const paymentOrganization = await createOrganization(client, {
      actorUserId: paymentOrganizer.userId,
      name: paymentJourney.organizationName
    });
    const paymentJourneyEvent = await createEvent(
      client,
      {
        actorUserId: paymentOrganizer.userId,
        organizationId: paymentOrganization.id,
        title: paymentJourney.eventTitle,
        startsAt: '2027-09-20T18:00',
        capacity: 20,
        registrationMode: 'auto_confirm',
        timeZone: 'Asia/Tokyo'
      },
      () => paymentJourney.eventSlug
    );
    await updateSettings(client, {
      actorUserId: paymentOrganizer.userId,
      eventId: paymentJourneyEvent.id,
      title: paymentJourney.eventTitle,
      description: 'A fixture for the complete development payment journey.',
      startsAt: '2027-09-20T18:00',
      endsAt: '2027-09-20T21:00',
      capacity: 20,
      venueName: 'Payment Hall',
      venueAddress: '',
      venueReveal: 'public',
      contact: 'payments@example.test',
      cancellationPolicy: '',
      registrationOpensAt: '2026-01-01T00:00',
      registrationClosesAt: '2027-09-20T17:00',
      registrationMode: 'auto_confirm',
      discordPolicy: 'not_used',
      timeZone: 'Asia/Tokyo'
    });
    await publishEvent(client, {
      actorUserId: paymentOrganizer.userId,
      eventId: paymentJourneyEvent.id
    });
    const event = await createEvent(client, {
      actorUserId: sweepOwner.userId,
      organizationId: organization.id,
      title: 'Sweep Event',
      startsAt: '2027-07-24T18:00',
      capacity: 40,
      registrationMode: 'auto_confirm',
      timeZone: 'Asia/Tokyo'
    });
    const draftPaymentEvent = await createEvent(client, {
      actorUserId: sweepOwner.userId,
      organizationId: organization.id,
      title: paymentEventFixtures.draft,
      startsAt: '2027-07-25T18:00',
      capacity: 20,
      registrationMode: 'auto_confirm',
      timeZone: 'Asia/Tokyo'
    });
    await createCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: draftPaymentEvent.id,
      title: 'Draft participation fee',
      amountMinor: 4_000n,
      currency: 'JPY',
      dueAt: null,
      instructions: ''
    });
    const frozenPaymentEvent = await createEvent(client, {
      actorUserId: sweepOwner.userId,
      organizationId: organization.id,
      title: paymentEventFixtures.frozen,
      startsAt: '2027-07-26T18:00',
      capacity: 20,
      registrationMode: 'auto_confirm',
      timeZone: 'Asia/Tokyo'
    });
    const frozenRegistrationId = '10000000-0000-4000-8000-000000000021';
    await client.db.insert(registrations).values({
      id: frozenRegistrationId,
      eventId: frozenPaymentEvent.id,
      userId: sweepOwner.userId,
      status: 'confirmed',
      displayNameSnapshot: 'Frozen Payment Participant',
      searchText: 'Frozen Payment Participant sweep-owner'
    });
    const frozenCollection = await createCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: frozenPaymentEvent.id,
      title: 'Frozen participation fee',
      amountMinor: 7_000n,
      currency: 'JPY',
      dueAt: new Date('2027-07-20T15:00:00Z'),
      instructions: ''
    });
    await openCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: frozenPaymentEvent.id
    });
    const frozenRequest = await client.db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.collectionId, frozenCollection.id))
      .limit(1);
    const cashMethod = await client.db
      .select({ id: collectionPaymentMethods.id })
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, frozenCollection.id),
          eq(collectionPaymentMethods.label, 'payments.default_method.cash.label')
        )
      )
      .limit(1);
    await confirmManualPayment(client, {
      actorUserId: sweepOwner.userId,
      paymentRequestId: frozenRequest[0].id,
      paymentMethodId: cashMethod[0].id,
      idempotencyKey: 'e2e-frozen-payment',
      externalReference: '',
      note: 'fixture settlement'
    });
    const fixtureFields = [
      { label: 'Display name preference', type: 'text', required: true, optionLabels: [] },
      { label: 'Access notes', type: 'textarea', required: false, optionLabels: [] },
      {
        label: 'Meal preference',
        type: 'select',
        required: true,
        optionLabels: ['Plant-based', 'No preference']
      },
      {
        label: 'Topics of interest',
        type: 'multiselect',
        required: false,
        optionLabels: ['Music', 'Games', 'Art']
      },
      { label: 'Bring a name badge', type: 'checkbox', required: false, optionLabels: [] },
      { label: 'Accept event policy', type: 'consent', required: false, optionLabels: [] }
    ] as const;
    for (const field of fixtureFields) {
      await upsertField(client, {
        actorUserId: sweepOwner.userId,
        eventId: event.id,
        ...field
      });
    }
    const archived = await upsertField(client, {
      actorUserId: sweepOwner.userId,
      eventId: event.id,
      label: 'Old travel question',
      type: 'text',
      required: false
    });
    await archiveField(client, {
      actorUserId: sweepOwner.userId,
      eventId: event.id,
      fieldId: archived.id
    });

    const publicOrganization = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: 'Public Fixtures'
    });
    const publicEvents = [
      { slug: 'gathering', title: 'Summer Gathering' },
      { slug: 'invitation', title: 'Invitation Gathering' },
      { slug: 'called-off', title: 'Called Off Gathering' },
      { slug: 'hidden-draft', title: 'Hidden Gathering' },
      { slug: 'past-record', title: 'Past Gathering' }
    ] as const;
    const createdPublicEvents = new Map<string, Awaited<ReturnType<typeof createEvent>>>();
    for (const fixture of publicEvents) {
      const item = await createEvent(
        client,
        {
          actorUserId: sweepOwner.userId,
          organizationId: publicOrganization.id,
          title: fixture.title,
          startsAt: '2027-08-14T13:00',
          capacity: 2,
          timeZone: 'Asia/Tokyo'
        },
        () => fixture.slug
      );
      createdPublicEvents.set(fixture.slug, item);
      await updateSettings(client, {
        actorUserId: sweepOwner.userId,
        eventId: item.id,
        title: fixture.title,
        description: 'A friendly afternoon for the community.',
        startsAt: '2027-08-14T13:00',
        endsAt: '2027-08-14T16:00',
        capacity: 2,
        venueName: 'Harbor Hall',
        venueAddress: '1-2-3 Minato',
        venueReveal: 'confirmed',
        contact: 'events@example.test',
        cancellationPolicy: 'Please contact the planning team if your plans change.',
        registrationOpensAt: '2026-01-01T00:00',
        registrationClosesAt: '2027-08-13T23:59',
        registrationMode: 'auto_confirm',
        discordPolicy: 'not_used',
        timeZone: 'Asia/Tokyo'
      });
    }
    const publicFormEventId = createdPublicEvents.get('gathering')!.id;
    const publicFormFields: Awaited<ReturnType<typeof upsertField>>[] = [];
    for (const field of fixtureFields) {
      publicFormFields.push(
        await upsertField(client, {
          actorUserId: sweepOwner.userId,
          eventId: publicFormEventId,
          ...field
        })
      );
    }
    for (const slug of ['gathering', 'invitation', 'called-off', 'past-record'] as const) {
      await publishEvent(client, {
        actorUserId: sweepOwner.userId,
        eventId: createdPublicEvents.get(slug)!.id
      });
    }
    await toggleEventUnlisted(client, {
      actorUserId: sweepOwner.userId,
      eventId: createdPublicEvents.get('invitation')!.id
    });
    const invitationEvent = createdPublicEvents.get('invitation')!;
    await client.db
      .update(events)
      .set({ discordPolicy: 'guild_join_required' })
      .where(eq(events.id, invitationEvent.id));
    await client.db.insert(eventDiscordIntegrations).values({
      eventId: invitationEvent.id,
      guildId: '110000000000000099',
      guildNameSnapshot: 'Invitation Guild',
      inviteUrl: 'https://discord.gg/offkai-fixture',
      roleId: '110000000000000098'
    });
    await cancelEvent(client, {
      actorUserId: sweepOwner.userId,
      eventId: createdPublicEvents.get('called-off')!.id,
      reason: 'Fixture cancellation'
    });
    await archiveEvent(client, {
      actorUserId: sweepOwner.userId,
      eventId: createdPublicEvents.get('past-record')!.id,
      reason: 'Fixture archive'
    });

    for (const [status, fixture] of Object.entries(participantFixtures)) {
      const username = status === 'cancelled' ? 'participant-withdrawn' : `participant-${status}`;
      const participant = await upsertDiscordIdentity(client, {
        providerUserId: fixture.discordUserId,
        username,
        displayName: fixture.displayName,
        avatarUrl: ''
      });
      await client.db.insert(registrations).values({
        id: fixture.registrationId,
        eventId: publicFormEventId,
        userId: participant.userId,
        status:
          status === 'withdrawal'
            ? 'applied'
            : ['paid', 'conflict', 'refunded'].includes(status)
              ? 'confirmed'
              : status,
        displayNameSnapshot: fixture.displayName,
        searchText: `${fixture.displayName} ${username}`
      });
      await client.db.insert(registrationFormAnswers).values({
        eventId: publicFormEventId,
        registrationId: fixture.registrationId,
        fieldId: publicFormFields[0].id,
        fieldKeySnapshot: publicFormFields[0].key,
        fieldLabelSnapshot: publicFormFields[0].label,
        fieldTypeSnapshot: publicFormFields[0].type,
        valueText: fixture.displayName,
        valueBool: null
      });
      if (status === 'applied') {
        await client.db.insert(registrationFormAnswers).values({
          eventId: publicFormEventId,
          registrationId: fixture.registrationId,
          fieldId: publicFormFields[1].id,
          fieldKeySnapshot: publicFormFields[1].key,
          fieldLabelSnapshot: publicFormFields[1].label,
          fieldTypeSnapshot: publicFormFields[1].type,
          valueText: '=SUM(1,1)',
          valueBool: null
        });
      }
    }

    const participantCollection = await createCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: publicFormEventId,
      title: 'Summer Gathering participation fee',
      amountMinor: 5_000n,
      currency: 'JPY',
      dueAt: new Date('2027-08-01T15:00:00Z'),
      instructions: 'Contact the planning team if you need to change your payment method.'
    });
    await openCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: participantCollection.eventId
    });
    const publicStripeAccountId = 'acct_sweep_payment_states';
    await client.db.insert(stripeConnectAccounts).values({
      organizationId: publicOrganization.id,
      stripeAccountId: publicStripeAccountId,
      dashboardType: 'express',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: 'ready',
      country: 'JP',
      defaultCurrency: 'jpy'
    });
    for (const state of ['paid', 'conflict', 'refunded'] as const) {
      const fixture = participantFixtures[state];
      const requestRows = await client.db
        .select({ id: paymentRequests.id })
        .from(paymentRequests)
        .where(eq(paymentRequests.registrationId, fixture.registrationId))
        .limit(1);
      const requestId = requestRows[0].id;
      const sessionId = `cs_sweep_${state}`;
      await client.db
        .update(paymentRequests)
        .set({
          status: 'payment_pending',
          stripeAccountId: publicStripeAccountId,
          checkoutSessionId: sessionId,
          paymentIntentId: `pi_sweep_${state}`,
          chargeType: 'direct'
        })
        .where(eq(paymentRequests.id, requestId));
      if (state !== 'paid') {
        await changeRegistrationStatus(client, {
          actorUserId: sweepOwner.userId,
          registrationId: fixture.registrationId,
          status: 'cancelled'
        });
      }
      const settlement = await settleCheckout(client, {
        stripeEventId: `evt_sweep_${state}`,
        eventType: 'checkout.session.completed',
        sessionId,
        paymentIntentId: `pi_sweep_${state}`,
        paymentStatus: 'paid',
        amountTotal: participantCollection.amountMinor,
        currency: participantCollection.currency,
        stripeAccountId: publicStripeAccountId,
        raw: { id: `evt_sweep_${state}`, type: 'checkout.session.completed' }
      });
      if (state === 'refunded') {
        await markConflictRefunded(client, {
          actorUserId: sweepOwner.userId,
          eventId: participantCollection.eventId,
          paymentRecordId: settlement.record!.id,
          note: 'Sweep fixture refund'
        });
      }
    }

    const suspendedOrganization = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: 'Suspended Fixtures'
    });
    const suspendedEvent = await createEvent(
      client,
      {
        actorUserId: sweepOwner.userId,
        organizationId: suspendedOrganization.id,
        title: 'Unavailable Gathering',
        startsAt: '2027-08-14T13:00',
        timeZone: 'Asia/Tokyo'
      },
      () => 'unavailable'
    );
    await publishEvent(client, {
      actorUserId: sweepOwner.userId,
      eventId: suspendedEvent.id
    });
    await client.db
      .update(organizations)
      .set({ suspendedAt: new Date() })
      .where(eq(organizations.id, suspendedOrganization.id));

    const campaignOrganization = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: 'Campaign Fixtures'
    });
    if (campaignOrganization.slug !== campaignFixtures.organizationSlug) {
      throw new Error('campaign fixture organization slug changed');
    }
    const openCampaign = await createCampaign(client, {
      actorUserId: sweepOwner.userId,
      organizationId: campaignOrganization.id,
      title: 'Community Flower Stand',
      slug: campaignFixtures.openSlug,
      description: 'Help the planning team prepare a flower stand for the community celebration.',
      unitPriceMinor: 1_500n,
      currency: 'JPY',
      goalMinor: 12_000n,
      maxUnitsPerPledge: 5,
      fulfillmentDate: '2027-12-01',
      fulfillmentNote: 'The organizer will publish a completion report after the celebration.',
      contact: 'campaign@example.test'
    });
    await changeCampaignStatus(client, {
      actorUserId: sweepOwner.userId,
      campaignId: openCampaign.id,
      status: 'open'
    });
    const campaignAccountId = 'acct_dev_campaign_fixtures';
    await client.db.insert(stripeConnectAccounts).values({
      organizationId: campaignOrganization.id,
      stripeAccountId: campaignAccountId,
      dashboardType: 'express',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: 'ready',
      country: 'JP',
      defaultCurrency: 'jpy'
    });
    const orderBase = {
      campaignId: openCampaign.id,
      userId: null,
      unitPriceMinor: 1_500n,
      currency: 'JPY',
      stripeAccountId: campaignAccountId
    } as const;
    await client.db.insert(orders).values([
      {
        ...orderBase,
        displayName: campaignFixtures.listedSupporter,
        listPublicly: true,
        unitCount: 2,
        amountMinor: 3_000n,
        status: 'paid',
        paidAt: new Date('2026-07-19T01:00:00Z'),
        accessToken: campaignFixtures.tokens.paid,
        checkoutSessionId: 'cs_campaign_paid',
        paymentIntentId: 'pi_campaign_paid',
        createdAt: new Date('2026-07-19T00:00:00Z')
      },
      {
        ...orderBase,
        displayName: campaignFixtures.privateSupporter,
        listPublicly: false,
        unitCount: 1,
        amountMinor: 1_500n,
        status: 'paid',
        paidAt: new Date('2026-07-19T01:05:00Z'),
        accessToken: campaignFixtures.tokens.privatePaid,
        checkoutSessionId: 'cs_campaign_private',
        paymentIntentId: 'pi_campaign_private',
        createdAt: new Date('2026-07-19T00:05:00Z')
      },
      {
        ...orderBase,
        displayName: 'Received Supporter',
        listPublicly: true,
        unitCount: 1,
        amountMinor: 1_500n,
        status: 'pending',
        accessToken: campaignFixtures.tokens.pending,
        stripeAccountId: ''
      },
      {
        ...orderBase,
        displayName: 'Processing Supporter',
        listPublicly: true,
        unitCount: 1,
        amountMinor: 1_500n,
        status: 'payment_pending',
        accessToken: campaignFixtures.tokens.paymentPending,
        checkoutSessionId: 'cs_campaign_processing'
      },
      {
        ...orderBase,
        displayName: 'Expired Supporter',
        listPublicly: true,
        unitCount: 1,
        amountMinor: 1_500n,
        status: 'expired',
        accessToken: campaignFixtures.tokens.expired,
        checkoutSessionId: 'cs_campaign_expired'
      },
      {
        ...orderBase,
        displayName: 'Withdrawn Supporter',
        listPublicly: true,
        unitCount: 1,
        amountMinor: 1_500n,
        status: 'cancelled',
        accessToken: campaignFixtures.tokens.cancelled,
        checkoutSessionId: 'cs_campaign_cancelled'
      },
      {
        ...orderBase,
        displayName: 'Conflict Supporter',
        listPublicly: true,
        unitCount: 1,
        amountMinor: 1_500n,
        status: 'expired',
        paidAt: new Date('2026-07-19T02:00:00Z'),
        accessToken: campaignFixtures.tokens.conflict,
        checkoutSessionId: 'cs_campaign_conflict'
      }
    ]);

    const closedCampaign = await createCampaign(client, {
      actorUserId: sweepOwner.userId,
      organizationId: campaignOrganization.id,
      title: 'Completed Support Project',
      slug: campaignFixtures.closedSlug,
      unitPriceMinor: 1_000n,
      currency: 'JPY',
      goalMinor: 5_000n,
      contact: 'campaign@example.test'
    });
    await changeCampaignStatus(client, {
      actorUserId: sweepOwner.userId,
      campaignId: closedCampaign.id,
      status: 'open'
    });
    await client.db.insert(orders).values({
      campaignId: closedCampaign.id,
      userId: null,
      displayName: 'Final Supporter',
      listPublicly: true,
      unitCount: 1,
      unitPriceMinor: 1_000n,
      amountMinor: 1_000n,
      currency: 'JPY',
      status: 'paid',
      paidAt: new Date('2026-07-19T03:00:00Z'),
      accessToken: campaignFixtures.tokens.closedPaid,
      stripeAccountId: campaignAccountId,
      checkoutSessionId: 'cs_campaign_closed',
      paymentIntentId: 'pi_campaign_closed'
    });
    await changeCampaignStatus(client, {
      actorUserId: sweepOwner.userId,
      campaignId: closedCampaign.id,
      status: 'closed'
    });
    await publishCampaignCompletionReport(client, {
      actorUserId: sweepOwner.userId,
      campaignId: closedCampaign.id,
      text: 'The project was delivered as planned. Materials cost ¥800 and transport cost ¥200.'
    });

    const setupOrganization = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: 'Campaign Payment Setup'
    });
    if (setupOrganization.slug !== campaignFixtures.notReadyOrganizationSlug) {
      throw new Error('not-ready campaign fixture organization slug changed');
    }
    const notReadyCampaign = await createCampaign(client, {
      actorUserId: sweepOwner.userId,
      organizationId: setupOrganization.id,
      title: 'Payment Setup Campaign',
      slug: campaignFixtures.notReadySlug,
      unitPriceMinor: 500n,
      currency: 'JPY',
      goalMinor: 0n,
      contact: 'setup@example.test'
    });
    await changeCampaignStatus(client, {
      actorUserId: sweepOwner.userId,
      campaignId: notReadyCampaign.id,
      status: 'open'
    });
  } finally {
    await closeDatabase(client);
  }
}
