import { expect, it } from 'vitest';
import { openDatabase } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  eventDiscordIntegrations,
  outboxEvents,
  registrations,
  events,
  paymentRecords,
  paymentRequests,
  registrationFormAnswers
} from '$lib/server/db/schema';

it('initializes the baseline and safely reruns it without changing history or pending retries', () => {
  const client = openDatabase(':memory:');
  try {
    runMigrations(client);
    client.db.$client.exec(`
      INSERT INTO users (id) VALUES ('user-a'), ('user-b');
      INSERT INTO organizations (id, name, slug) VALUES ('org', 'Organization', 'organization');
      INSERT INTO events (id, organization_id, title, slug, starts_at, ends_at, visibility, discord_policy, registration_opens_at, registration_closes_at, payment_requirement)
      VALUES ('event-a', 'org', 'A', 'a', 100, 200, 'public', 'optional', 1, 90, 'pay_later'), ('event-b', 'org', 'B', 'b', 100, 200, 'public', 'optional', 1, 90, 'none');
      INSERT INTO registrations (id, event_id, user_id, status, display_name_snapshot, created_at)
      VALUES ('a', 'event-a', 'user-a', 'cancelled', 'A', 10), ('b', 'event-a', 'user-b', 'confirmed', 'B', 20), ('c', 'event-b', 'user-a', 'confirmed', 'A', 10);
      INSERT INTO event_discord_integrations (id, event_id, guild_id, staff_channel_id, role_id)
      VALUES ('integration', 'event-a', '400000000000000001', '500000000000000001', '600000000000000001');
      INSERT INTO collections (id, event_id, title, amount_minor, currency, status)
      VALUES ('collection', 'event-a', 'Fee', 1000, 'JPY', 'open');
      INSERT INTO collection_payment_methods (id, collection_id, label, timing, confirmation)
      VALUES ('cash', 'collection', 'Cash', 'onsite', 'manual');
      INSERT INTO payment_requests (id, event_id, collection_id, registration_id, collection_payment_method_id, amount_minor, currency, status)
      VALUES ('request', 'event-a', 'collection', 'b', 'cash', 1000, 'JPY', 'paid');
      INSERT INTO payment_records (id, payment_request_id, registration_id, collection_id, collection_payment_method_id, amount_minor, currency, status, idempotency_key)
      VALUES ('record', 'request', 'b', 'collection', 'cash', 1000, 'JPY', 'settled', 'old-cash');
      INSERT INTO event_form_fields (id, event_id, field_key, label, field_type)
      VALUES ('field', 'event-a', 'food', 'Food', 'text');
      INSERT INTO registration_form_answers (id, event_id, registration_id, field_id, field_key_snapshot, field_label_snapshot, field_type_snapshot, value_text)
      VALUES ('answer', 'event-a', 'b', 'field', 'food', 'Food', 'text', 'Saved answer');
      INSERT INTO outbox_events (id, type, payload_json, status, attempts, last_error, next_attempt_at)
      VALUES ('task', 'discord.role_sync_requested', '{"event_id":"event-a","registration_id":"b"}', 'pending', 3, 'Previously unavailable', 123456);
    `);
    // Startup migration checks must leave existing application rows untouched.
    runMigrations(client);
    expect(
      client.db.$client.prepare('select count(*) as count from __drizzle_migrations').get()
    ).toEqual({ count: 2 });
    expect(
      client.db
        .select()
        .from(registrations)
        .all()
        .every((row) => row.locale === 'en')
    ).toBe(true);
    expect(
      client.db
        .select()
        .from(registrations)
        .all()
        .map((row) => [row.id, row.number, row.status])
    ).toEqual([
      ['a', 1, 'cancelled'],
      ['b', 2, 'confirmed'],
      ['c', 1, 'confirmed']
    ]);
    expect(client.db.select().from(eventDiscordIntegrations).get()).toMatchObject({
      roleId: '600000000000000001',
      staffChannelId: '500000000000000001',
      staffRoleId: '',
      notificationChannelId: ''
    });
    expect(client.db.select().from(outboxEvents).get()).toMatchObject({
      status: 'pending',
      attempts: 3,
      lastError: 'Previously unavailable',
      nextAttemptAt: new Date(123456),
      payloadJson: { event_id: 'event-a', registration_id: 'b' }
    });
    client.db.$client.exec(
      "INSERT INTO registrations (id, event_id, user_id, status, display_name_snapshot) VALUES ('d', 'event-a', 'user-a', 'confirmed', 'A')"
    );
    expect(
      client.db
        .select()
        .from(registrations)
        .all()
        .find((row) => row.id === 'd')!.number
    ).toBe(3);
    expect(
      client.db
        .select()
        .from(events)
        .all()
        .find((row) => row.id === 'event-a')?.paymentRequirement
    ).toBe('pay_later');
    expect(client.db.select().from(events).get()).toMatchObject({
      paymentOpensAt: null,
      paymentDueAt: null,
      additionalOpensAt: null
    });
    expect(client.db.select().from(paymentRequests).get()).toMatchObject({
      id: 'request',
      status: 'paid',
      amountMinor: 1000n,
      applicationFeeAmount: 0n,
      remindedAt: null
    });
    expect(client.db.select().from(paymentRecords).get()).toMatchObject({
      id: 'record',
      amountMinor: 1000n,
      idempotencyKey: 'old-cash'
    });
    expect(client.db.select().from(registrationFormAnswers).get()?.valueText).toBe('Saved answer');
    expect(client.db.$client.pragma('foreign_key_check')).toEqual([]);
  } finally {
    client.db.$client.close();
  }
});
