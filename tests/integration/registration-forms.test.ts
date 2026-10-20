import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { auditLogs, eventFormFieldOptions, eventFormFields } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  addFormPreset,
  archiveField,
  cancelEvent,
  createEvent,
  EventError,
  listFormFields,
  reorderField,
  upsertField,
  type EventSummary
} from '$lib/server/domain/events';
import { createOrganization, inviteMember, OrganizationError } from '$lib/server/domain/orgs';

describe('registration form domain', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let staffId: string;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'registration-form-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    ownerId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '140000000000000001',
        username: 'form-owner',
        displayName: 'Form Owner',
        avatarUrl: ''
      })
    ).userId;
    staffId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '140000000000000002',
        username: 'form-staff',
        displayName: 'Form Staff',
        avatarUrl: ''
      })
    ).userId;
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  async function draft(prefix: string): Promise<EventSummary> {
    sequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `${prefix} ${sequence}`
    });
    return createEvent(client, {
      actorUserId: ownerId,
      organizationId: organization.id,
      title: `${prefix} event`,
      startsAt: '2027-10-01T18:00',
      timeZone: 'Asia/Tokyo'
    });
  }

  it('upserts, reorders, and archives fields while preserving positions, options, and audits', async () => {
    const event = await draft('Definition operations');
    const first = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Display name note',
      type: 'text',
      required: false
    });
    const second = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Meal choice',
      type: 'select',
      required: true,
      optionLabels: ['Vegan', 'No preference']
    });
    const third = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Bring a badge',
      type: 'checkbox',
      required: false
    });
    expect([first.position, second.position, third.position]).toEqual([10, 20, 30]);
    expect(second.options.map(({ position }) => position)).toEqual([10, 20]);

    const edited = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      fieldId: first.id,
      label: 'Updated display note',
      type: 'textarea',
      required: true
    });
    expect(edited.key).toBe(first.key);
    expect(edited.position).toBe(10);

    await expect(
      reorderField(client, {
        actorUserId: ownerId,
        eventId: event.id,
        fieldId: third.id,
        direction: 'up'
      })
    ).resolves.toBe(true);
    let listed = await listFormFields(client, ownerId, event.id);
    expect(listed.map(({ id }) => id)).toEqual([first.id, third.id, second.id]);
    expect(listed.map(({ position }) => position)).toEqual([10, 20, 30]);

    await archiveField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      fieldId: third.id
    });
    listed = await listFormFields(client, ownerId, event.id);
    expect(listed.map(({ id }) => id)).toEqual([first.id, second.id]);
    const withArchived = await listFormFields(client, ownerId, event.id, true);
    expect(withArchived.find(({ id }) => id === third.id)?.archivedAt).not.toBeNull();

    const storedOptions = await client.db
      .select()
      .from(eventFormFieldOptions)
      .where(eq(eventFormFieldOptions.fieldId, second.id))
      .orderBy(asc(eventFormFieldOptions.position));
    expect(storedOptions.map(({ optionKey, label }) => [optionKey, label])).toEqual([
      ['opt_1', 'Vegan'],
      ['opt_2', 'No preference']
    ]);
    const logs = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, event.id))
      .orderBy(asc(auditLogs.createdAt));
    expect(logs.map(({ action }) => action)).toEqual([
      'event.create',
      'event.form_field_upsert',
      'event.form_field_upsert',
      'event.form_field_upsert',
      'event.form_field_upsert',
      'event.form_field_reorder',
      'event.form_field_archive'
    ]);
  });

  it('adds localized presets idempotently and never revives an archived preset', async () => {
    const event = await draft('Preset idempotency');
    const attempts = await Promise.all([
      addFormPreset(client, {
        actorUserId: ownerId,
        eventId: event.id,
        presetKey: 'x_handle',
        locale: 'ja'
      }),
      addFormPreset(client, {
        actorUserId: ownerId,
        eventId: event.id,
        presetKey: 'x_handle',
        locale: 'ja'
      })
    ]);
    expect(attempts.map(({ created }) => created).sort()).toEqual([false, true]);
    const first = attempts.find(({ created }) => created)!;
    expect(first.created).toBe(true);
    expect(first.field).toMatchObject({ key: 'x_handle', label: 'X (Twitter) アカウント' });
    await expect(
      addFormPreset(client, {
        actorUserId: ownerId,
        eventId: event.id,
        presetKey: 'x_handle',
        locale: 'en'
      })
    ).resolves.toMatchObject({ created: false });
    await archiveField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      fieldId: first.field!.id
    });
    await expect(
      addFormPreset(client, {
        actorUserId: ownerId,
        eventId: event.id,
        presetKey: 'x_handle',
        locale: 'en'
      })
    ).resolves.toMatchObject({ created: false });
    expect((await listFormFields(client, ownerId, event.id)).length).toBe(0);
  });

  it('forces consent fields to be required', async () => {
    const event = await draft('Consent required');
    const field = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Accept the policy',
      type: 'consent',
      required: false
    });
    expect(field.required).toBe(true);
    const stored = await client.db
      .select({ required: eventFormFields.required })
      .from(eventFormFields)
      .where(eq(eventFormFields.id, field.id));
    expect(stored[0].required).toBe(true);
  });

  it('freezes every definition mutation after cancellation', async () => {
    const event = await draft('Cancelled form');
    const field = await upsertField(client, {
      actorUserId: ownerId,
      eventId: event.id,
      label: 'Before cancellation',
      type: 'text',
      required: false
    });
    await cancelEvent(client, {
      actorUserId: ownerId,
      eventId: event.id,
      reason: 'test freeze'
    });
    const expected = { code: 'illegal_transition' } satisfies Partial<EventError>;
    await expect(
      upsertField(client, {
        actorUserId: ownerId,
        eventId: event.id,
        label: 'After cancellation',
        type: 'text',
        required: false
      })
    ).rejects.toMatchObject(expected);
    await expect(
      archiveField(client, { actorUserId: ownerId, eventId: event.id, fieldId: field.id })
    ).rejects.toMatchObject(expected);
    await expect(
      reorderField(client, {
        actorUserId: ownerId,
        eventId: event.id,
        fieldId: field.id,
        direction: 'up'
      })
    ).rejects.toMatchObject(expected);
    await expect(
      addFormPreset(client, {
        actorUserId: ownerId,
        eventId: event.id,
        presetKey: 'notes',
        locale: 'en'
      })
    ).rejects.toMatchObject(expected);
  });

  it('allows staff to read but not mutate the form', async () => {
    const event = await draft('Staff read only');
    await inviteMember(client, {
      actorUserId: ownerId,
      organizationId: event.organizationId,
      discordUserId: '140000000000000002',
      role: 'staff'
    });
    await expect(listFormFields(client, staffId, event.id)).resolves.toEqual([]);
    await expect(
      upsertField(client, {
        actorUserId: staffId,
        eventId: event.id,
        label: 'Unauthorized field',
        type: 'text',
        required: false
      })
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
  });
});
