import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  auditLogs,
  collectionPaymentMethods,
  paymentRecords,
  paymentRequests
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  createEvent,
  publishEvent,
  updateSettings,
  type EventSummary
} from '$lib/server/domain/events';
import {
  CollectionError,
  confirmManualPayment,
  createCollection,
  openCollection,
  updateCollection,
  waivePaymentRequest
} from '$lib/server/domain/payments';
import { changeRegistrationStatus, createRegistration } from '$lib/server/domain/registrations';
import { createOrganization } from '$lib/server/domain/orgs';

describe('collection and payment request lifecycle', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let participantSequence = 0;
  let eventSequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'collection-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    ownerId = await createUser('collection-owner', 'Collection Owner');
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  it('validates JPY and backfills confirmed registrations when a draft opens', async () => {
    const event = await publishedEvent('approval');
    const person = await participant();
    const registration = await createRegistration(client, registrationInput(event, person));
    await changeRegistrationStatus(client, {
      actorUserId: ownerId,
      registrationId: registration.id,
      status: 'confirmed'
    });

    await expect(
      createCollection(client, collectionInput(event.id, { currency: 'USD' }))
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<CollectionError>);
    const collection = await createCollection(client, collectionInput(event.id));
    expect(collection.status).toBe('draft');
    expect(collection.currency).toBe('JPY');
    expect(await requestRows(collection.id)).toHaveLength(0);

    await openCollection(client, { actorUserId: ownerId, eventId: event.id });
    const requests = await requestRows(collection.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      registrationId: registration.id,
      amountMinor: 5_000n,
      currency: 'JPY',
      status: 'pending'
    });
  });

  it('creates requests on auto-confirm and organizer-confirm paths, then cancels pending requests', async () => {
    const automatic = await publishedEvent('auto_confirm');
    const automaticCollection = await createCollection(client, collectionInput(automatic.id));
    await openCollection(client, { actorUserId: ownerId, eventId: automatic.id });
    const autoParticipant = await participant();
    const autoRegistration = await createRegistration(
      client,
      registrationInput(automatic, autoParticipant)
    );
    expect(autoRegistration.status).toBe('confirmed');
    expect(await requestRows(automaticCollection.id)).toHaveLength(1);

    await changeRegistrationStatus(client, {
      actorUserId: ownerId,
      registrationId: autoRegistration.id,
      status: 'cancelled'
    });
    expect((await requestRows(automaticCollection.id))[0].status).toBe('cancelled');

    const approval = await publishedEvent('approval');
    const approvalCollection = await createCollection(client, collectionInput(approval.id));
    await openCollection(client, { actorUserId: ownerId, eventId: approval.id });
    const approvalParticipant = await participant();
    const applied = await createRegistration(
      client,
      registrationInput(approval, approvalParticipant)
    );
    expect(await requestRows(approvalCollection.id)).toHaveLength(0);
    await changeRegistrationStatus(client, {
      actorUserId: ownerId,
      registrationId: applied.id,
      status: 'confirmed'
    });
    expect(await requestRows(approvalCollection.id)).toHaveLength(1);
  });

  it('freezes collection amount once a request starts and confirms manual payments idempotently', async () => {
    const { event, collectionId, requestId } = await openCollectionWithRequest();
    await client.db
      .update(paymentRequests)
      .set({ status: 'payment_pending' })
      .where(eq(paymentRequests.id, requestId));
    await expect(
      updateCollection(client, {
        ...collectionInput(event.id),
        amountMinor: 6_000n
      })
    ).rejects.toMatchObject({ code: 'amount_frozen' } satisfies Partial<CollectionError>);

    const cash = await method(collectionId, 'payments.default_method.cash.label');
    const command = {
      actorUserId: ownerId,
      paymentRequestId: requestId,
      paymentMethodId: cash.id,
      idempotencyKey: `payment-confirm:${requestId}`,
      externalReference: 'cash desk',
      note: 'received'
    };
    const first = await confirmManualPayment(client, command);
    const duplicate = await confirmManualPayment(client, command);
    expect(duplicate.id).toBe(first.id);
    const recordCount = await client.db
      .select({ value: count(paymentRecords.id) })
      .from(paymentRecords)
      .where(eq(paymentRecords.paymentRequestId, requestId));
    expect(recordCount[0].value).toBe(1);
    expect((await requestRows(collectionId))[0].status).toBe('paid');
    const audits = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, 'payment_request'), eq(auditLogs.targetId, requestId)));
    expect(audits.filter(({ action }) => action === 'payment.confirm_manual')).toHaveLength(1);
  });

  it('waives a request idempotently with one zero-value settled record', async () => {
    const { requestId } = await openCollectionWithRequest();
    const command = {
      actorUserId: ownerId,
      paymentRequestId: requestId,
      idempotencyKey: `payment-waive:${requestId}`,
      reason: 'organizer waiver'
    };
    const first = await waivePaymentRequest(client, command);
    const duplicate = await waivePaymentRequest(client, command);
    expect(duplicate.id).toBe(first.id);
    expect(first).toMatchObject({ amountMinor: 0n, status: 'settled' });
    const request = await client.db
      .select({ status: paymentRequests.status })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, requestId));
    expect(request[0].status).toBe('waived');
  });

  async function openCollectionWithRequest() {
    const event = await publishedEvent('auto_confirm');
    const collection = await createCollection(client, collectionInput(event.id));
    await openCollection(client, { actorUserId: ownerId, eventId: event.id });
    const person = await participant();
    await createRegistration(client, registrationInput(event, person));
    const request = (await requestRows(collection.id))[0];
    return { event, collectionId: collection.id, requestId: request.id };
  }

  async function method(collectionId: string, label: string) {
    const rows = await client.db
      .select()
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, collectionId),
          eq(collectionPaymentMethods.label, label)
        )
      );
    return rows[0];
  }

  function requestRows(collectionId: string) {
    return client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.collectionId, collectionId));
  }

  async function participant() {
    participantSequence += 1;
    const displayName = `Collection Participant ${participantSequence}`;
    return {
      userId: await createUser(`collection-participant-${participantSequence}`, displayName),
      displayName
    };
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

  async function publishedEvent(mode: 'auto_confirm' | 'approval'): Promise<EventSummary> {
    eventSequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `Collection Group ${eventSequence}`
    });
    const slug = `collection-event-${eventSequence}`;
    const event = await createEvent(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: `Collection Event ${eventSequence}`,
        startsAt: '2027-10-01T18:00',
        capacity: null,
        registrationMode: mode,
        timeZone: 'Asia/Tokyo'
      },
      () => slug
    );
    await updateSettings(client, {
      actorUserId: ownerId,
      eventId: event.id,
      title: event.title,
      description: '',
      startsAt: '2027-10-01T18:00',
      endsAt: '2027-10-01T21:00',
      capacity: null,
      venueName: '',
      venueAddress: '',
      venueReveal: 'public',
      contact: '',
      cancellationPolicy: '',
      registrationOpensAt: '2026-01-01T00:00',
      registrationClosesAt: '2027-10-01T17:00',
      registrationMode: mode,
      discordPolicy: 'not_used',
      timeZone: 'Asia/Tokyo'
    });
    return publishEvent(client, { actorUserId: ownerId, eventId: event.id });
  }

  function registrationInput(event: EventSummary, person: { userId: string; displayName: string }) {
    return {
      organizationSlug: `collection-group-${eventSequence}`,
      eventSlug: event.slug,
      userId: person.userId,
      displayName: person.displayName,
      answers: []
    };
  }

  function collectionInput(eventId: string, overrides: Partial<{ currency: string }> = {}) {
    return {
      actorUserId: ownerId,
      eventId,
      title: 'Participation fee',
      amountMinor: 5_000n,
      currency: 'jpy',
      dueAt: new Date('2027-09-20T15:00:00Z'),
      instructions: 'Follow the selected payment instructions.',
      ...overrides
    };
  }
});
