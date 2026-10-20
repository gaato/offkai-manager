import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  auditLogs,
  eventFormFieldOptions,
  eventFormFields,
  events,
  registrationFormAnswerOptions,
  registrationFormAnswers,
  registrations,
  users
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  createEvent,
  publishEvent,
  updateSettings,
  upsertField,
  type EventSummary
} from '$lib/server/domain/events';
import {
  changeRegistrationStatus,
  createRegistration,
  getPublicEventBySlug,
  getOwnedRegistration,
  listParticipants,
  participantExport,
  publicVenue,
  RegistrationError,
  withdrawRegistration,
  type CreateRegistrationInput
} from '$lib/server/domain/registrations';
import { buildParticipantCSV } from '$lib/server/exports/participants';
import { createOrganization } from '$lib/server/domain/orgs';

describe('participant registration domain', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let organizationId: string;
  const participants: { userId: string; displayName: string }[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'participant-registration-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    ownerId = await createUser(0, 'Registration Owner');
    organizationId = (
      await createOrganization(client, {
        actorUserId: ownerId,
        name: 'Registration Test Group'
      })
    ).id;
    for (let index = 1; index <= 14; index += 1) {
      const displayName = `Participant ${index}`;
      participants.push({ userId: await createUser(index, displayName), displayName });
    }
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  async function createUser(index: number, displayName: string): Promise<string> {
    return (
      await upsertDiscordIdentity(client, {
        providerUserId: `150000000000000${String(index).padStart(3, '0')}`,
        username: `registration-user-${index}`,
        displayName,
        avatarUrl: ''
      })
    ).userId;
  }

  async function publishedEvent(
    slug: string,
    mode: 'auto_confirm' | 'approval',
    capacity: number | null
  ): Promise<EventSummary> {
    const created = await createEvent(
      client,
      {
        actorUserId: ownerId,
        organizationId,
        title: `${slug} event`,
        startsAt: '2027-10-01T18:00',
        capacity,
        registrationMode: mode,
        timeZone: 'Asia/Tokyo'
      },
      () => slug
    );
    await updateSettings(client, {
      actorUserId: ownerId,
      eventId: created.id,
      title: `${slug} event`,
      description: '',
      startsAt: '2027-10-01T18:00',
      endsAt: '2027-10-01T21:00',
      capacity,
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
    return publishEvent(client, { actorUserId: ownerId, eventId: created.id });
  }

  function input(
    event: EventSummary,
    participant: (typeof participants)[number],
    answers: CreateRegistrationInput['answers'] = []
  ): CreateRegistrationInput {
    return {
      organizationSlug: 'registration-test-group',
      eventSlug: event.slug,
      userId: participant.userId,
      displayName: participant.displayName,
      answers
    };
  }

  it('serializes eight parallel registrations at capacity one', async () => {
    const event = await publishedEvent('capacity-race', 'auto_confirm', 1);
    const created = await Promise.all(
      participants
        .slice(0, 8)
        .map((participant) => createRegistration(client, input(event, participant)))
    );
    expect(created.filter(({ status }) => status === 'confirmed')).toHaveLength(1);
    expect(created.filter(({ status }) => status === 'waitlisted')).toHaveLength(7);
    const stored = await client.db
      .select({ status: registrations.status })
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(stored.filter(({ status }) => status === 'confirmed')).toHaveLength(1);
    expect(stored.filter(({ status }) => status === 'waitlisted')).toHaveLength(7);
  });

  it('keeps approval-mode applications out of capacity', async () => {
    const event = await publishedEvent('review-mode', 'approval', 1);
    const created = await Promise.all(
      participants
        .slice(8, 11)
        .map((participant) => createRegistration(client, input(event, participant)))
    );
    expect(created.map(({ status }) => status)).toEqual(['applied', 'applied', 'applied']);
    const stored = await client.db
      .select({ status: registrations.status })
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(stored.some(({ status }) => status === 'confirmed')).toBe(false);
  });

  it('blocks a duplicate active registration with a domain error', async () => {
    const event = await publishedEvent('duplicate-active', 'auto_confirm', null);
    await createRegistration(client, input(event, participants[11]));
    await expect(createRegistration(client, input(event, participants[11]))).rejects.toMatchObject({
      code: 'duplicate'
    } satisfies Partial<RegistrationError>);
  });

  it('rejects stale options and false consent, then stores answer and option snapshots', async () => {
    const event = await publishedEvent('answer-snapshots', 'auto_confirm', null);
    const select = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Meal choice',
      type: 'select',
      required: true,
      optionLabels: ['Plant-based', 'No preference']
    });
    const consent = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Accept event rules',
      type: 'consent',
      required: true
    });
    const answer = (
      fieldKey: string,
      optionIds: string[] = [],
      valueBool: boolean | null = null
    ) => ({
      fieldKey,
      valueText: '',
      valueBool,
      optionIds
    });

    await expect(
      createRegistration(
        client,
        input(event, participants[12], [
          answer(select.key, ['00000000-0000-4000-8000-000000000000']),
          answer(consent.key, [], true)
        ])
      )
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<RegistrationError>);
    await expect(
      createRegistration(
        client,
        input(event, participants[12], [
          answer(select.key, [select.options[0].id]),
          answer(consent.key, [], false)
        ])
      )
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<RegistrationError>);

    const registration = await createRegistration(
      client,
      input(event, participants[12], [
        answer(select.key, [select.options[0].id]),
        answer(consent.key, [], true)
      ])
    );
    expect(registration.displayNameSnapshot).toBe(participants[12].displayName);
    expect(registration.searchText).toBe(`${participants[12].displayName} registration-user-13`);
    const snapshots = await client.db
      .select()
      .from(registrationFormAnswers)
      .where(eq(registrationFormAnswers.registrationId, registration.id))
      .orderBy(asc(registrationFormAnswers.createdAt));
    expect(
      snapshots.map(({ fieldKeySnapshot, fieldLabelSnapshot, fieldTypeSnapshot }) => [
        fieldKeySnapshot,
        fieldLabelSnapshot,
        fieldTypeSnapshot
      ])
    ).toEqual([
      [select.key, 'Meal choice', 'select'],
      [consent.key, 'Accept event rules', 'consent']
    ]);
    const selected = await client.db
      .select()
      .from(registrationFormAnswerOptions)
      .where(eq(registrationFormAnswerOptions.answerId, snapshots[0].id));
    expect(selected[0]).toMatchObject({
      optionKeySnapshot: select.options[0].key,
      optionLabelSnapshot: 'Plant-based'
    });
    await client.db
      .update(eventFormFields)
      .set({ label: 'Renamed meal choice' })
      .where(eq(eventFormFields.id, select.id));
    await client.db
      .update(eventFormFieldOptions)
      .set({ label: 'Renamed plant option' })
      .where(eq(eventFormFieldOptions.id, select.options[0].id));
    const detail = await getOwnedRegistration(client, registration.id, participants[12].userId);
    expect(detail.answers[0]).toMatchObject({
      label: 'Meal choice',
      optionLabels: ['Plant-based']
    });
    const audit = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, registration.id));
    expect(audit).toEqual([{ action: 'registration.create' }]);
  });

  it('promotes the oldest waitlisted registration and permits registration again', async () => {
    const event = await publishedEvent('withdraw-promotion', 'auto_confirm', 1);
    const confirmed = await createRegistration(client, input(event, participants[0]));
    const oldestWaitlisted = await createRegistration(client, input(event, participants[1]));
    const newestWaitlisted = await createRegistration(client, input(event, participants[2]));

    const result = await withdrawRegistration(client, {
      registrationId: confirmed.id,
      userId: participants[0].userId
    });
    expect(result.registration.status).toBe('cancelled');
    expect(result.promotedRegistrationId).toBe(oldestWaitlisted.id);
    const after = await client.db
      .select({ id: registrations.id, status: registrations.status })
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(after.find(({ id }) => id === oldestWaitlisted.id)?.status).toBe('confirmed');
    expect(after.find(({ id }) => id === newestWaitlisted.id)?.status).toBe('waitlisted');

    const again = await createRegistration(client, input(event, participants[0]));
    expect(again.status).toBe('waitlisted');
    const actions = await client.db
      .select({ action: auditLogs.action, targetId: auditLogs.targetId })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, event.id));
    expect(actions).toContainEqual({ action: 'registration.withdraw', targetId: confirmed.id });
    expect(actions).toContainEqual({
      action: 'registration.promote',
      targetId: oldestWaitlisted.id
    });
  });

  it('rejects registration creation for a suspended user', async () => {
    const event = await publishedEvent('suspended-user-registration', 'auto_confirm', null);
    const userId = await createUser(99, 'Suspended Participant');
    await client.db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, userId));
    await expect(
      createRegistration(client, input(event, { userId, displayName: 'Suspended Participant' }))
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<RegistrationError>);
  });

  it('promotes an existing waiter without finite capacity and no-ops an empty waitlist', async () => {
    const unlimited = await publishedEvent('withdraw-unlimited', 'auto_confirm', null);
    const unlimitedConfirmed = await createRegistration(client, input(unlimited, participants[3]));
    const inconsistentWaiter = await createRegistration(client, input(unlimited, participants[4]));
    await client.db
      .update(registrations)
      .set({ status: 'waitlisted' })
      .where(eq(registrations.id, inconsistentWaiter.id));

    const unlimitedResult = await withdrawRegistration(client, {
      registrationId: unlimitedConfirmed.id,
      userId: participants[3].userId
    });
    expect(unlimitedResult.promotedRegistrationId).toBe(inconsistentWaiter.id);
    const waiterAfter = await client.db
      .select({ status: registrations.status })
      .from(registrations)
      .where(eq(registrations.id, inconsistentWaiter.id));
    expect(waiterAfter[0]?.status).toBe('confirmed');

    const emptyWaitlist = await publishedEvent('withdraw-empty-waitlist', 'auto_confirm', 1);
    const onlyConfirmed = await createRegistration(client, input(emptyWaitlist, participants[5]));
    const emptyResult = await withdrawRegistration(client, {
      registrationId: onlyConfirmed.id,
      userId: participants[5].userId
    });
    expect(emptyResult.promotedRegistrationId).toBeNull();
    const promotionAudits = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, emptyWaitlist.id));
    expect(promotionAudits.some(({ action }) => action === 'registration.promote')).toBe(false);
  });

  it('loads registrations only for their owner and enforces venue visibility', async () => {
    const cases = [
      { slug: 'venue-public-pending', reveal: 'public', mode: 'approval', expected: true },
      { slug: 'venue-public-secured', reveal: 'public', mode: 'auto_confirm', expected: true },
      { slug: 'venue-private-pending', reveal: 'confirmed', mode: 'approval', expected: false },
      { slug: 'venue-private-secured', reveal: 'confirmed', mode: 'auto_confirm', expected: true }
    ] as const;
    for (const [index, fixture] of cases.entries()) {
      const event = await publishedEvent(fixture.slug, fixture.mode, null);
      await client.db
        .update(events)
        .set({
          venueName: 'Matrix Hall',
          venueAddress: 'Hidden address',
          venueReveal: fixture.reveal
        })
        .where(eq(events.id, event.id));
      const registration = await createRegistration(client, input(event, participants[index + 3]));
      const detail = await getOwnedRegistration(
        client,
        registration.id,
        participants[index + 3].userId
      );
      const venue = publicVenue(detail.event, detail.registration.status === 'confirmed');
      expect(Boolean(venue.address), fixture.slug).toBe(fixture.expected);
      await expect(
        getOwnedRegistration(client, registration.id, participants[index + 4].userId)
      ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<RegistrationError>);
    }
  });

  it('rejects withdrawal once the event has started', async () => {
    const event = await publishedEvent('started-withdrawal', 'auto_confirm', null);
    const registration = await createRegistration(client, input(event, participants[7]));
    await client.db
      .update(events)
      .set({
        startsAt: new Date('2025-01-01T00:00:00Z'),
        endsAt: new Date('2025-01-01T03:00:00Z')
      })
      .where(eq(events.id, event.id));
    await expect(
      withdrawRegistration(client, {
        registrationId: registration.id,
        userId: participants[7].userId
      })
    ).rejects.toMatchObject({ code: 'not_withdrawable' } satisfies Partial<RegistrationError>);
  });

  it('allows active registrations to withdraw before start after event lifecycle changes', async () => {
    const cases = [
      { slug: 'cancelled-withdrawal', lifecycle: { cancelledAt: new Date() } },
      { slug: 'archived-withdrawal', lifecycle: { archivedAt: new Date() } }
    ] as const;
    for (const [index, fixture] of cases.entries()) {
      const event = await publishedEvent(fixture.slug, 'auto_confirm', 1);
      const participant = participants[index + 8];
      const registration = await createRegistration(client, input(event, participant));
      await client.db.update(events).set(fixture.lifecycle).where(eq(events.id, event.id));
      await expect(
        withdrawRegistration(client, {
          registrationId: registration.id,
          userId: participant.userId
        })
      ).resolves.toMatchObject({ registration: { status: 'cancelled' } });
    }
  });

  it('allows exactly one parallel organizer confirmation at capacity one', async () => {
    const event = await publishedEvent('organizer-confirm-race', 'approval', 1);
    const applied = await Promise.all(
      participants
        .slice(0, 6)
        .map((participant) => createRegistration(client, input(event, participant)))
    );

    const results = await Promise.allSettled(
      applied.map((registration) =>
        changeRegistrationStatus(client, {
          actorUserId: ownerId,
          registrationId: registration.id,
          status: 'confirmed'
        })
      )
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(5);
    const stored = await client.db
      .select({ status: registrations.status })
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(stored.filter(({ status }) => status === 'confirmed')).toHaveLength(1);
  });

  it('promotes the oldest waiter after organizer cancellation', async () => {
    const event = await publishedEvent('organizer-cancel-promotion', 'auto_confirm', 1);
    const confirmed = await createRegistration(client, input(event, participants[6]));
    const oldestWaitlisted = await createRegistration(client, input(event, participants[7]));
    const newestWaitlisted = await createRegistration(client, input(event, participants[8]));

    await changeRegistrationStatus(client, {
      actorUserId: ownerId,
      registrationId: confirmed.id,
      status: 'cancelled'
    });
    const stored = await client.db
      .select({ id: registrations.id, status: registrations.status })
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(stored.find(({ id }) => id === confirmed.id)?.status).toBe('cancelled');
    expect(stored.find(({ id }) => id === oldestWaitlisted.id)?.status).toBe('confirmed');
    expect(stored.find(({ id }) => id === newestWaitlisted.id)?.status).toBe('waitlisted');
    const actions = await client.db
      .select({ action: auditLogs.action, targetId: auditLogs.targetId })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, event.id));
    expect(actions).toContainEqual({ action: 'registration.cancel', targetId: confirmed.id });
    expect(actions).toContainEqual({
      action: 'registration.promote',
      targetId: oldestWaitlisted.id
    });
  });

  it('searches registrations by display name and Discord username', async () => {
    const event = await publishedEvent('participant-search', 'approval', null);
    const first = await createRegistration(client, input(event, participants[9]));
    await createRegistration(client, input(event, participants[10]));

    const byDisplayName = await listParticipants(client, {
      actorUserId: ownerId,
      eventId: event.id,
      status: 'all',
      query: participants[9].displayName.toLowerCase()
    });
    const byUsername = await listParticipants(client, {
      actorUserId: ownerId,
      eventId: event.id,
      status: 'all',
      query: 'REGISTRATION-USER-10'
    });
    expect(byDisplayName.rows.map(({ id }) => id)).toEqual([first.id]);
    expect(byUsername.rows.map(({ id }) => id)).toEqual([first.id]);
  });

  it('loads participant and public pages with bounded statement counts', async () => {
    const event = await publishedEvent('bounded-page-queries', 'approval', null);
    await Promise.all(
      participants
        .slice(0, 12)
        .map((participant) => createRegistration(client, input(event, participant)))
    );

    const statements: string[] = [];
    const countedSql = postgres(container.getConnectionUri(), {
      max: 1,
      debug: (_connection, query) => statements.push(query)
    });
    const countedClient: DatabaseClient = { sql: countedSql, db: drizzle(countedSql) };
    try {
      await countedSql`select 1`;
      statements.length = 0;
      const participantList = await listParticipants(countedClient, {
        actorUserId: ownerId,
        eventId: event.id,
        status: 'all',
        query: ''
      });
      expect(participantList.rows).toHaveLength(12);
      expect(statements.length, statements.join('\n')).toBeLessThanOrEqual(7);

      statements.length = 0;
      const publicEvent = await getPublicEventBySlug(
        countedClient,
        'registration-test-group',
        event.slug
      );
      expect(publicEvent.event.id).toBe(event.id);
      expect(statements.length, statements.join('\n')).toBeLessThanOrEqual(1);
    } finally {
      await closeDatabase(countedClient);
    }
  });

  it('builds localized BOM CSV and neutralizes formulas from snapshot values', async () => {
    const event = await publishedEvent('participant-csv', 'approval', null);
    const textField = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: '=Unsafe field',
      type: 'text',
      required: true
    });
    const multiselect = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Topics',
      type: 'multiselect',
      required: false,
      optionLabels: ['Music', 'Games']
    });
    await createRegistration(client, {
      ...input(event, participants[13]),
      displayName: '=Formula participant',
      answers: [
        { fieldKey: textField.key, valueText: '+unsafe', valueBool: null, optionIds: [] },
        {
          fieldKey: multiselect.key,
          valueText: '',
          valueBool: null,
          optionIds: multiselect.options.map(({ id }) => id)
        }
      ]
    });

    const data = await participantExport(client, ownerId, event.id);
    const english = buildParticipantCSV(data, 'en', 'Asia/Tokyo');
    const japanese = buildParticipantCSV(data, 'ja', 'Asia/Tokyo');
    expect(english.startsWith('\uFEFF')).toBe(true);
    expect(japanese.startsWith('\uFEFF')).toBe(true);
    expect(english.split('\r\n')[0]).toBe(
      "\uFEFFDisplay name,Discord username,Status,Registered at,'=Unsafe field,Topics"
    );
    expect(japanese.split('\r\n')[0]).toBe(
      "\uFEFF表示名,Discordユーザー名,ステータス,申込日時,'=Unsafe field,Topics"
    );
    expect(english).toContain("'=Formula participant");
    expect(english).toContain("'+unsafe");
    expect(english).toContain('Music; Games');
    expect(english).toContain('Awaiting planning-team confirmation');
    expect(japanese).toContain('主催者の確認待ち');
  });
});
