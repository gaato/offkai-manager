import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
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
  let client: DatabaseClient;
  let ownerId: string;
  let staffId: string;
  let sequence = 0;
  beforeEach(async () => {
    client = testDatabase();
    ownerId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: '140000000000000001',
          username: 'form-owner',
          displayName: 'Form Owner',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
    staffId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: '140000000000000002',
          username: 'form-staff',
          displayName: 'Form Staff',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });
  async function draft(prefix: string): Promise<EventSummary> {
    sequence += 1;
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: `${prefix} ${sequence}`
      },
      fixedClock
    );
    return createEvent(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: `${prefix} event`,
        startsAt: '2027-10-01T18:00',
        timeZone: 'Asia/Tokyo'
      },
      undefined,
      fixedClock
    );
  }
  it('upserts, reorders, and archives fields while preserving positions, options, and audits', async () => {
    const event = await draft('Definition operations');
    fixedClock.advance();
    const first = await upsertField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        label: 'Display name note',
        type: 'text',
        required: false
      },
      fixedClock
    );
    fixedClock.advance();
    const second = await upsertField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        label: 'Meal choice',
        type: 'select',
        required: true,
        optionLabels: ['Vegan', 'No preference']
      },
      fixedClock
    );
    fixedClock.advance();
    const third = await upsertField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        label: 'Bring a badge',
        type: 'checkbox',
        required: false
      },
      fixedClock
    );
    expect([first.position, second.position, third.position]).toEqual([10, 20, 30]);
    expect(second.options.map(({ position }) => position)).toEqual([10, 20]);
    fixedClock.advance();
    const edited = await upsertField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        fieldId: first.id,
        label: 'Updated display note',
        type: 'textarea',
        required: true
      },
      fixedClock
    );
    expect(edited.key).toBe(first.key);
    expect(edited.position).toBe(10);
    fixedClock.advance();
    await expect(
      reorderField(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          fieldId: third.id,
          direction: 'up'
        },
        fixedClock
      )
    ).resolves.toBe(true);
    let listed = await listFormFields(client, ownerId, event.id);
    expect(listed.map(({ id }) => id)).toEqual([first.id, third.id, second.id]);
    expect(listed.map(({ position }) => position)).toEqual([10, 20, 30]);
    fixedClock.advance();
    await archiveField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        fieldId: third.id
      },
      fixedClock
    );
    listed = await listFormFields(client, ownerId, event.id);
    expect(listed.map(({ id }) => id)).toEqual([first.id, second.id]);
    const withArchived = await listFormFields(client, ownerId, event.id, true);
    expect(withArchived.find(({ id }) => id === third.id)?.archivedAt).not.toBeNull();
    const storedOptions = client.db
      .select()
      .from(eventFormFieldOptions)
      .where(eq(eventFormFieldOptions.fieldId, second.id))
      .orderBy(asc(eventFormFieldOptions.position))
      .all();
    expect(storedOptions.map(({ optionKey, label }) => [optionKey, label])).toEqual([
      ['opt_1', 'Vegan'],
      ['opt_2', 'No preference']
    ]);
    const logs = client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, event.id))
      .orderBy(asc(auditLogs.createdAt))
      .all();
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
      addFormPreset(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          presetKey: 'x_handle',
          locale: 'ja'
        },
        fixedClock
      ),
      addFormPreset(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          presetKey: 'x_handle',
          locale: 'ja'
        },
        fixedClock
      )
    ]);
    expect(attempts.map(({ created }) => created).sort()).toEqual([false, true]);
    const first = attempts.find(({ created }) => created)!;
    expect(first.created).toBe(true);
    expect(first.field).toMatchObject({ key: 'x_handle', label: 'X (Twitter) アカウント' });
    await expect(
      addFormPreset(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          presetKey: 'x_handle',
          locale: 'en'
        },
        fixedClock
      )
    ).resolves.toMatchObject({ created: false });
    await archiveField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        fieldId: first.field!.id
      },
      fixedClock
    );
    await expect(
      addFormPreset(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          presetKey: 'x_handle',
          locale: 'en'
        },
        fixedClock
      )
    ).resolves.toMatchObject({ created: false });
    expect((await listFormFields(client, ownerId, event.id)).length).toBe(0);
  });
  it('forces consent fields to be required', async () => {
    const event = await draft('Consent required');
    const field = await upsertField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        label: 'Accept the policy',
        type: 'consent',
        required: false
      },
      fixedClock
    );
    expect(field.required).toBe(true);
    const stored = client.db
      .select({ required: eventFormFields.required })
      .from(eventFormFields)
      .where(eq(eventFormFields.id, field.id))
      .all();
    expect(stored[0].required).toBe(true);
  });
  it('freezes every definition mutation after cancellation', async () => {
    const event = await draft('Cancelled form');
    const field = await upsertField(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        label: 'Before cancellation',
        type: 'text',
        required: false
      },
      fixedClock
    );
    await cancelEvent(
      client,
      {
        actorUserId: ownerId,
        eventId: event.id,
        reason: 'test freeze'
      },
      fixedClock
    );
    const expected = { code: 'illegal_transition' } satisfies Partial<EventError>;
    await expect(
      upsertField(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          label: 'After cancellation',
          type: 'text',
          required: false
        },
        fixedClock
      )
    ).rejects.toMatchObject(expected);
    await expect(
      archiveField(
        client,
        { actorUserId: ownerId, eventId: event.id, fieldId: field.id },
        fixedClock
      )
    ).rejects.toMatchObject(expected);
    fixedClock.advance();
    await expect(
      reorderField(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          fieldId: field.id,
          direction: 'up'
        },
        fixedClock
      )
    ).rejects.toMatchObject(expected);
    await expect(
      addFormPreset(
        client,
        {
          actorUserId: ownerId,
          eventId: event.id,
          presetKey: 'notes',
          locale: 'en'
        },
        fixedClock
      )
    ).rejects.toMatchObject(expected);
  });
  it('allows staff to read but not mutate the form', async () => {
    const event = await draft('Staff read only');
    await inviteMember(
      client,
      {
        actorUserId: ownerId,
        organizationId: event.organizationId,
        discordUserId: '140000000000000002',
        role: 'staff'
      },
      fixedClock
    );
    await expect(listFormFields(client, staffId, event.id)).resolves.toEqual([]);
    await expect(
      upsertField(
        client,
        {
          actorUserId: staffId,
          eventId: event.id,
          label: 'Unauthorized field',
          type: 'text',
          required: false
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
  });
});
