import { and, eq } from 'drizzle-orm';
import { loadConfig } from '$lib/server/config';
import { systemClock } from '$lib/server/clock';
import { parseWallClock } from '$lib/server/time';
import { appendAudit } from '$lib/server/domain/audit';
import { closeDatabase, createDatabaseClient, write } from '$lib/server/db/client';
import {
  organizations,
  events,
  eventDiscordIntegrations,
  externalAccounts,
  collectionPaymentMethods,
  paymentRequests,
  registrationFormAnswers,
  registrations,
  stripeConnectAccounts,
  users
} from '$lib/server/db/schema';
import { runMigrations } from '$lib/server/db/migrate';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  archiveField,
  createEvent,
  publishEvent,
  updateSettings,
  upsertField,
  updatePanelTemplates
} from '$lib/server/domain/events';
import { createOrganization, inviteMember } from '$lib/server/domain/orgs';
import {
  confirmManualPayment,
  createCollection,
  markConflictRefunded,
  openCollection,
  settleCheckout
} from '$lib/server/domain/payments';
import { changeRegistrationStatus, createRegistration } from '$lib/server/domain/registrations';
import {
  discordSetupFixture,
  devStripeOrganizations,
  e2eUsers,
  participantFixtures,
  opsJourney,
  paymentEventFixtures,
  paymentJourney,
  stripeSweepFixtures,
  suspendedUserFixture
} from './fixtures';
export async function seedE2E(databasePath: string): Promise<void> {
  const client = createDatabaseClient(
    loadConfig({
      OFFKAI_DATABASE_PATH: databasePath,
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
    client.db
      .insert(users)
      .values({
        id: suspendedUserFixture.userId,
        suspendedAt: new Date('2026-07-01T00:00:00Z')
      })
      .run();
    client.db
      .insert(externalAccounts)
      .values({
        userId: suspendedUserFixture.userId,
        provider: 'discord',
        providerUserId: suspendedUserFixture.discordUserId,
        username: 'suspended-user',
        displayName: suspendedUserFixture.displayName,
        avatarUrl: ''
      })
      .run();
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
      client.db
        .insert(stripeConnectAccounts)
        .values({
          organizationId: stateOrganization.id,
          stripeAccountId: `acct_sweep_${index + 1}`,
          dashboardType: 'express',
          chargesEnabled: ready,
          payoutsEnabled: ready,
          detailsSubmitted,
          onboardingStatus: fixture.status,
          country: 'JP',
          defaultCurrency: 'jpy'
        })
        .run();
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
    const paymentParticipant = await upsertDiscordIdentity(client, {
      providerUserId: e2eUsers.paymentParticipant,
      username: 'payment-participant',
      displayName: 'Payment Participant',
      avatarUrl: ''
    });
    await createRegistration(client, {
      userId: paymentParticipant.userId,
      organizationSlug: paymentOrganization.slug,
      eventSlug: paymentJourneyEvent.slug,
      displayName: 'Payment Participant',
      answers: []
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
      amountMinor: 4000n,
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
    client.db
      .insert(registrations)
      .values({
        id: frozenRegistrationId,
        eventId: frozenPaymentEvent.id,
        userId: sweepOwner.userId,
        status: 'confirmed',
        displayNameSnapshot: 'Frozen Payment Participant',
        searchText: 'Frozen Payment Participant sweep-owner'
      })
      .run();
    const frozenCollection = await createCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: frozenPaymentEvent.id,
      title: 'Frozen participation fee',
      amountMinor: 7000n,
      currency: 'JPY',
      dueAt: new Date('2027-07-20T15:00:00Z'),
      instructions: ''
    });
    await openCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: frozenPaymentEvent.id
    });
    const frozenRequest = client.db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.collectionId, frozenCollection.id))
      .limit(1)
      .all();
    const cashMethod = client.db
      .select({ id: collectionPaymentMethods.id })
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, frozenCollection.id),
          eq(collectionPaymentMethods.label, 'payments.default_method.cash.label')
        )
      )
      .limit(1)
      .all();
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
        ...field,
        optionLabels: [...field.optionLabels]
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
    const publicEvents = [{ slug: 'gathering', title: 'Summer Gathering' }] as const;
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
          ...field,
          optionLabels: [...field.optionLabels]
        })
      );
    }
    await publishEvent(client, {
      actorUserId: sweepOwner.userId,
      eventId: publicFormEventId
    });
    for (const [status, fixture] of Object.entries(participantFixtures)) {
      // Keep synthetic usernames independent of status so enum sweeps test labels, not user data.
      const username = `participant-${fixture.discordUserId}`;
      const participant = await upsertDiscordIdentity(client, {
        providerUserId: fixture.discordUserId,
        username,
        displayName: fixture.displayName,
        avatarUrl: ''
      });
      client.db
        .insert(registrations)
        .values({
          id: fixture.registrationId,
          eventId: publicFormEventId,
          userId: participant.userId,
          status: ['paid', 'conflict', 'refunded'].includes(status) ? 'confirmed' : status,
          displayNameSnapshot: fixture.displayName,
          searchText: `${fixture.displayName} ${username}`
        })
        .run();
      client.db
        .insert(registrationFormAnswers)
        .values({
          eventId: publicFormEventId,
          registrationId: fixture.registrationId,
          fieldId: publicFormFields[0].id,
          fieldKeySnapshot: publicFormFields[0].key,
          fieldLabelSnapshot: publicFormFields[0].label,
          fieldTypeSnapshot: publicFormFields[0].type,
          valueText: fixture.displayName,
          valueBool: null
        })
        .run();
      if (status === 'applied') {
        client.db
          .insert(registrationFormAnswers)
          .values({
            eventId: publicFormEventId,
            registrationId: fixture.registrationId,
            fieldId: publicFormFields[1].id,
            fieldKeySnapshot: publicFormFields[1].key,
            fieldLabelSnapshot: publicFormFields[1].label,
            fieldTypeSnapshot: publicFormFields[1].type,
            valueText: '=SUM(1,1)',
            valueBool: null
          })
          .run();
      }
    }
    const participantCollection = await createCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: publicFormEventId,
      title: 'Summer Gathering participation fee',
      amountMinor: 5000n,
      currency: 'JPY',
      dueAt: new Date('2027-08-01T15:00:00Z'),
      instructions: 'Contact the planning team if you need to change your payment method.'
    });
    await openCollection(client, {
      actorUserId: sweepOwner.userId,
      eventId: participantCollection.eventId
    });
    const publicStripeAccountId = 'acct_sweep_payment_states';
    client.db
      .insert(stripeConnectAccounts)
      .values({
        organizationId: publicOrganization.id,
        stripeAccountId: publicStripeAccountId,
        dashboardType: 'express',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        onboardingStatus: 'ready',
        country: 'JP',
        defaultCurrency: 'jpy'
      })
      .run();
    for (const state of ['paid', 'conflict', 'refunded'] as const) {
      const fixture = participantFixtures[state];
      const requestRows = client.db
        .select({ id: paymentRequests.id })
        .from(paymentRequests)
        .where(eq(paymentRequests.registrationId, fixture.registrationId))
        .limit(1)
        .all();
      const requestId = requestRows[0].id;
      const sessionId = `cs_sweep_${state}`;
      client.db
        .update(paymentRequests)
        .set({
          status: 'payment_pending',
          stripeAccountId: publicStripeAccountId,
          checkoutSessionId: sessionId,
          paymentIntentId: `pi_sweep_${state}`,
          chargeType: 'direct'
        })
        .where(eq(paymentRequests.id, requestId))
        .run();
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
    const setupOrg = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: discordSetupFixture.organizationName
    });
    const setupStartsAt = parseWallClock('2027-12-01T18:00', 'Asia/Tokyo');
    // createEvent already appends an audit FK, so this fixture needs its final ID at insertion.
    write(client, (tx) => {
      const setupEvent = tx
        .insert(events)
        .values({
          id: discordSetupFixture.eventId,
          organizationId: setupOrg.id,
          title: discordSetupFixture.title,
          slug: 'previous-discord-event',
          startsAt: setupStartsAt,
          endsAt: parseWallClock('2027-12-01T21:00', 'Asia/Tokyo'),
          capacity: 25,
          venueName: 'Copied Hall',
          visibility: 'draft',
          discordPolicy: 'not_used',
          registrationOpensAt: systemClock.now(),
          registrationClosesAt: setupStartsAt,
          createdAt: systemClock.now(),
          updatedAt: systemClock.now()
        })
        .returning()
        .get()!;
      appendAudit(tx, {
        actorUserId: sweepOwner.userId,
        eventId: setupEvent.id,
        action: 'event.create',
        targetType: 'event',
        targetId: setupEvent.id,
        after: {
          title: setupEvent.title,
          slug: setupEvent.slug,
          visibility: setupEvent.visibility,
          copyFromEventId: null
        }
      });
    });
    client.db
      .insert(eventDiscordIntegrations)
      .values({
        eventId: discordSetupFixture.eventId,
        guildId: discordSetupFixture.guildId,
        roleId: discordSetupFixture.highRoleId,
        announcementChannelId: discordSetupFixture.channelId,
        guildNameSnapshot: 'Setup Test Server'
      })
      .run();
    await upsertField(client, {
      actorUserId: sweepOwner.userId,
      eventId: discordSetupFixture.eventId,
      label: 'Copied question',
      type: 'text',
      required: false
    });
    updatePanelTemplates(client, {
      actorUserId: sweepOwner.userId,
      eventId: discordSetupFixture.eventId,
      panelTemplateJa: 'コピー {title}',
      panelTemplateEn: 'Copied panel {title}'
    });
    const suspendedOrganization = await createOrganization(client, {
      actorUserId: sweepOwner.userId,
      name: 'Suspended Fixtures'
    });
    client.db
      .update(organizations)
      .set({ suspendedAt: new Date('2026-10-21T00:00:00.000Z') })
      .where(eq(organizations.id, suspendedOrganization.id))
      .run();
  } finally {
    await closeDatabase(client);
  }
}
