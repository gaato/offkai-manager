import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
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
  let client: DatabaseClient;
  let ownerId: string;
  let participantSequence = 0;
  let eventSequence = 0;
  beforeEach(async () => {
    client = testDatabase();
    ownerId = await createUser('collection-owner', 'Collection Owner');
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });
  it('validates JPY and backfills confirmed registrations when a draft opens', async () => {
    const event = await publishedEvent('approval');
    const person = await participant();
    const registration = await createRegistration(
      client,
      registrationInput(event, person),
      fixedClock
    );
    await changeRegistrationStatus(
      client,
      {
        actorUserId: ownerId,
        registrationId: registration.id,
        status: 'confirmed'
      },
      fixedClock
    );
    await expect(
      createCollection(client, collectionInput(event.id, { currency: 'USD' }), fixedClock)
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<CollectionError>);
    const collection = await createCollection(client, collectionInput(event.id), fixedClock);
    expect(collection.status).toBe('draft');
    expect(collection.currency).toBe('JPY');
    expect(await requestRows(collection.id)).toHaveLength(0);
    await openCollection(client, { actorUserId: ownerId, eventId: event.id }, fixedClock);
    const requests = await requestRows(collection.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      registrationId: registration.id,
      amountMinor: 5000n,
      currency: 'JPY',
      status: 'pending'
    });
  });
  it('creates requests on auto-confirm and organizer-confirm paths, then cancels pending requests', async () => {
    const automatic = await publishedEvent('auto_confirm');
    const automaticCollection = await createCollection(
      client,
      collectionInput(automatic.id),
      fixedClock
    );
    await openCollection(client, { actorUserId: ownerId, eventId: automatic.id }, fixedClock);
    const autoParticipant = await participant();
    const autoRegistration = await createRegistration(
      client,
      registrationInput(automatic, autoParticipant),
      fixedClock
    );
    expect(autoRegistration.status).toBe('confirmed');
    expect(await requestRows(automaticCollection.id)).toHaveLength(1);
    await changeRegistrationStatus(
      client,
      {
        actorUserId: ownerId,
        registrationId: autoRegistration.id,
        status: 'cancelled'
      },
      fixedClock
    );
    expect((await requestRows(automaticCollection.id))[0].status).toBe('cancelled');
    const approval = await publishedEvent('approval');
    const approvalCollection = await createCollection(
      client,
      collectionInput(approval.id),
      fixedClock
    );
    await openCollection(client, { actorUserId: ownerId, eventId: approval.id }, fixedClock);
    const approvalParticipant = await participant();
    const applied = await createRegistration(
      client,
      registrationInput(approval, approvalParticipant),
      fixedClock
    );
    expect(await requestRows(approvalCollection.id)).toHaveLength(0);
    await changeRegistrationStatus(
      client,
      {
        actorUserId: ownerId,
        registrationId: applied.id,
        status: 'confirmed'
      },
      fixedClock
    );
    expect(await requestRows(approvalCollection.id)).toHaveLength(1);
  });
  it('freezes collection amount once a request starts and confirms manual payments idempotently', async () => {
    const { event, collectionId, requestId } = await openCollectionWithRequest();
    client.db
      .update(paymentRequests)
      .set({ status: 'payment_pending' })
      .where(eq(paymentRequests.id, requestId))
      .run();
    await expect(
      updateCollection(
        client,
        {
          ...collectionInput(event.id),
          amountMinor: 6000n
        },
        fixedClock
      )
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
    const first = await confirmManualPayment(client, command, fixedClock);
    const duplicate = await confirmManualPayment(client, command, fixedClock);
    expect(duplicate.id).toBe(first.id);
    const recordCount = client.db
      .select({ value: count(paymentRecords.id) })
      .from(paymentRecords)
      .where(eq(paymentRecords.paymentRequestId, requestId))
      .all();
    expect(recordCount[0].value).toBe(1);
    expect((await requestRows(collectionId))[0].status).toBe('paid');
    const audits = client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, 'payment_request'), eq(auditLogs.targetId, requestId)))
      .all();
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
    const first = await waivePaymentRequest(client, command, fixedClock);
    const duplicate = await waivePaymentRequest(client, command, fixedClock);
    expect(duplicate.id).toBe(first.id);
    expect(first).toMatchObject({ amountMinor: 0n, status: 'settled' });
    const request = client.db
      .select({ status: paymentRequests.status })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, requestId))
      .all();
    expect(request[0].status).toBe('waived');
  });
  async function openCollectionWithRequest() {
    const event = await publishedEvent('auto_confirm');
    const collection = await createCollection(client, collectionInput(event.id), fixedClock);
    await openCollection(client, { actorUserId: ownerId, eventId: event.id }, fixedClock);
    const person = await participant();
    await createRegistration(client, registrationInput(event, person), fixedClock);
    const request = (await requestRows(collection.id))[0];
    return { event, collectionId: collection.id, requestId: request.id };
  }
  async function method(collectionId: string, label: string) {
    const rows = client.db
      .select()
      .from(collectionPaymentMethods)
      .where(
        and(
          eq(collectionPaymentMethods.collectionId, collectionId),
          eq(collectionPaymentMethods.label, label)
        )
      )
      .all();
    return rows[0];
  }
  function requestRows(collectionId: string) {
    return client.db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.collectionId, collectionId))
      .all();
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
      await upsertDiscordIdentity(
        client,
        {
          providerUserId,
          username: providerUserId,
          displayName,
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
  }
  async function publishedEvent(mode: 'auto_confirm' | 'approval'): Promise<EventSummary> {
    eventSequence += 1;
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: `Collection Group ${eventSequence}`
      },
      fixedClock
    );
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
      () => slug,
      fixedClock
    );
    await updateSettings(
      client,
      {
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
      },
      fixedClock
    );
    return publishEvent(client, { actorUserId: ownerId, eventId: event.id }, fixedClock);
  }
  function registrationInput(
    event: EventSummary,
    person: {
      userId: string;
      displayName: string;
    }
  ) {
    return {
      organizationSlug: `collection-group-${eventSequence}`,
      eventSlug: event.slug,
      userId: person.userId,
      displayName: person.displayName,
      answers: []
    };
  }
  function collectionInput(
    eventId: string,
    overrides: Partial<{
      currency: string;
    }> = {}
  ) {
    return {
      actorUserId: ownerId,
      eventId,
      title: 'Participation fee',
      amountMinor: 5000n,
      currency: 'jpy',
      dueAt: new Date('2027-09-20T15:00:00Z'),
      instructions: 'Follow the selected payment instructions.',
      ...overrides
    };
  }
});
