import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseClient } from '$lib/server/db/client';
import { testDatabase } from '../database';

const expectedTables = [
  'audit_logs',
  'checkin_records',
  'collection_payment_methods',
  'collections',
  'discord_layout_resources',
  'discord_panels',
  'event_discord_integrations',
  'event_form_field_options',
  'event_form_fields',
  'events',
  'external_accounts',
  'interaction_drafts',
  'organization_memberships',
  'organizations',
  'outbox_events',
  'payment_records',
  'payment_requests',
  'registration_form_answer_options',
  'registration_form_answers',
  'registrations',
  'stripe_connect_accounts',
  'stripe_webhook_events',
  'users'
] as const;

const expectedUniqueConstraints = [
  ['external_accounts', ['provider', 'provider_user_id']],
  ['organizations', ['slug']],
  ['organization_memberships', ['organization_id', 'user_id']],
  ['events', ['organization_id', 'slug']],
  ['event_discord_integrations', ['event_id']],
  ['event_form_fields', ['event_id', 'field_key']],
  ['event_form_fields', ['event_id', 'id']],
  ['event_form_field_options', ['field_id', 'option_key']],
  ['event_form_field_options', ['field_id', 'id']],
  ['registrations', ['event_id', 'number']],
  ['discord_panels', ['channel_id', 'message_id']],
  ['interaction_drafts', ['user_id', 'event_id', 'kind']],
  ['registrations', ['event_id', 'id']],
  ['stripe_connect_accounts', ['organization_id']],
  ['stripe_connect_accounts', ['stripe_account_id']],
  ['stripe_connect_accounts', ['organization_id', 'stripe_account_id']],
  ['collections', ['event_id', 'id']],
  ['collections', ['id', 'currency']],
  ['collection_payment_methods', ['collection_id', 'label']],
  ['collection_payment_methods', ['collection_id', 'id']],
  ['payment_requests', ['collection_id', 'registration_id']],
  ['payment_requests', ['id', 'registration_id']],
  ['payment_requests', ['id', 'collection_id']],
  ['registration_form_answers', ['registration_id', 'field_id']],
  ['registration_form_answers', ['id', 'field_id']],
  ['stripe_webhook_events', ['stripe_event_id']]
] as const;

const expectedPartialUniqueIndexes = [
  ['discord_layout_resources', ['event_id', 'guild_id', 'kind'], 'retired_at is null'],
  ['discord_panels', ['event_id', 'locale'], 'deleted_at is null'],
  ['organizations', ['personal_owner_user_id'], 'personal_owner_user_id is not null'],
  ['outbox_events', ['dedupe_key'], "status = 'pending' and dedupe_key is not null"],
  ['registrations', ['event_id', 'user_id'], "status <> 'cancelled'"],
  ['payment_records', ['idempotency_key'], "idempotency_key <> ''"],
  ['payment_requests', ['checkout_session_id'], "checkout_session_id <> ''"],
  ['payment_requests', ['payment_intent_id'], "payment_intent_id <> ''"]
] as const;

const expectedCompositeForeignKeys = [
  ['payment_requests', ['event_id', 'collection_id'], 'collections', ['event_id', 'id']],
  ['payment_requests', ['event_id', 'registration_id'], 'registrations', ['event_id', 'id']],
  ['payment_requests', ['collection_id', 'currency'], 'collections', ['id', 'currency']],
  [
    'payment_requests',
    ['collection_id', 'collection_payment_method_id'],
    'collection_payment_methods',
    ['collection_id', 'id']
  ],
  [
    'payment_records',
    ['payment_request_id', 'registration_id'],
    'payment_requests',
    ['id', 'registration_id']
  ],
  [
    'payment_records',
    ['payment_request_id', 'collection_id'],
    'payment_requests',
    ['id', 'collection_id']
  ],
  [
    'payment_records',
    ['collection_id', 'collection_payment_method_id'],
    'collection_payment_methods',
    ['collection_id', 'id']
  ],
  [
    'registration_form_answers',
    ['event_id', 'registration_id'],
    'registrations',
    ['event_id', 'id']
  ],
  ['registration_form_answers', ['event_id', 'field_id'], 'event_form_fields', ['event_id', 'id']],
  [
    'registration_form_answer_options',
    ['answer_id', 'field_id'],
    'registration_form_answers',
    ['id', 'field_id']
  ],
  [
    'registration_form_answer_options',
    ['field_id', 'option_id'],
    'event_form_field_options',
    ['field_id', 'id']
  ],
  ['checkin_records', ['event_id', 'registration_id'], 'registrations', ['event_id', 'id']]
] as const;

const expectedRetentionForeignKeys = [
  ['audit_logs', ['actor_user_id'], 'users', ['id'], 'SET NULL'],
  ['audit_logs', ['event_id'], 'events', ['id'], 'SET NULL'],
  ['checkin_records', ['actor_user_id'], 'users', ['id'], 'SET NULL'],
  ['checkin_records', ['event_id'], 'events', ['id'], 'NO ACTION'],
  ['checkin_records', ['registration_id'], 'registrations', ['id'], 'NO ACTION'],
  ['payment_records', ['confirmed_by_user_id'], 'users', ['id'], 'SET NULL'],
  ['payment_records', ['payment_request_id'], 'payment_requests', ['id'], 'NO ACTION'],
  ['payment_records', ['registration_id'], 'registrations', ['id'], 'NO ACTION'],
  ['payment_requests', ['collection_id'], 'collections', ['id'], 'NO ACTION'],
  ['payment_requests', ['registration_id'], 'registrations', ['id'], 'NO ACTION']
] as const;

const checkFragments: Readonly<Record<string, readonly string[]>> = {
  event_form_fields_required_check: ['required', '0,1'],
  registration_form_answers_value_bool_check: ['value_bool', '0,1'],
  stripe_connect_accounts_charges_enabled_check: ['charges_enabled', '0,1'],
  stripe_connect_accounts_payouts_enabled_check: ['payouts_enabled', '0,1'],
  stripe_connect_accounts_details_submitted_check: ['details_submitted', '0,1'],
  collection_payment_methods_enabled_check: ['enabled', '0,1'],
  payment_records_raw_payload_json_check: ['json_valid', 'raw_payload_json'],
  stripe_webhook_events_payload_json_check: ['json_valid', 'payload_json'],
  audit_logs_before_json_check: ['json_valid', 'before_json'],
  audit_logs_after_json_check: ['json_valid', 'after_json'],
  audit_logs_metadata_json_check: ['json_valid', 'metadata_json'],
  outbox_events_payload_json_check: ['json_valid', 'payload_json'],
  external_accounts_provider_check: ['provider', 'discord'],
  organizations_name_check: ['length(name)>0'],
  organizations_slug_check: ['length(slug)>0'],
  organization_memberships_role_check: ['role', 'owner', 'organizer', 'staff', 'viewer'],
  organization_memberships_status_check: ['status', 'active', 'disabled'],
  events_title_check: ['length(title)>0'],
  events_slug_check: ['length(slug)>0'],
  events_ends_at_check: ['ends_at>starts_at'],
  events_capacity_check: ['capacity>=0'],
  events_visibility_check: ['visibility', 'draft', 'public', 'unlisted'],
  events_discord_policy_check: [
    'discord_policy',
    'not_used',
    'optional',
    'login_required',
    'guild_join_required'
  ],
  events_venue_reveal_check: ['venue_reveal', 'public', 'confirmed'],
  events_registration_mode_check: ['registration_mode', 'auto_confirm', 'approval'],
  event_form_fields_field_key_check: ['length(field_key)>0'],
  event_form_fields_label_check: ['length(label)>0'],
  event_form_fields_field_type_check: [
    'field_type',
    'text',
    'textarea',
    'select',
    'multiselect',
    'checkbox',
    'consent'
  ],
  event_form_field_options_option_key_check: ['length(option_key)>0'],
  event_form_field_options_label_check: ['length(label)>0'],
  registrations_status_check: ['status', 'applied', 'confirmed', 'waitlisted', 'cancelled'],
  registrations_display_name_snapshot_check: ['length(display_name_snapshot)>0'],
  registration_form_answers_field_key_snapshot_check: ['length(field_key_snapshot)>0'],
  registration_form_answers_field_label_snapshot_check: ['length(field_label_snapshot)>0'],
  registration_form_answers_field_type_snapshot_check: [
    'field_type_snapshot',
    'text',
    'textarea',
    'select',
    'multiselect',
    'checkbox',
    'consent'
  ],
  registration_form_answer_options_option_key_snapshot_check: ['length(option_key_snapshot)>0'],
  registration_form_answer_options_option_label_snapshot_check: ['length(option_label_snapshot)>0'],
  stripe_connect_accounts_stripe_account_id_check: ['length(stripe_account_id)>0'],
  stripe_connect_accounts_dashboard_type_check: ['dashboard_type', 'express', 'full', 'none'],
  stripe_connect_accounts_onboarding_status_check: [
    'onboarding_status',
    'not_connected',
    'onboarding_required',
    'pending_verification',
    'ready',
    'disabled'
  ],
  collections_title_check: ['length(title)>0'],
  collections_amount_minor_check: ['amount_minor>=0'],
  collections_currency_check: ['length(currency)=3'],
  collections_status_check: ['status', 'draft', 'open', 'closed', 'archived'],
  collection_payment_methods_label_check: ['length(label)>0'],
  collection_payment_methods_timing_check: ['timing', 'advance', 'onsite', 'none'],
  collection_payment_methods_confirmation_check: ['confirmation', 'internal', 'manual', 'none'],
  payment_requests_amount_minor_check: ['amount_minor>=0'],
  payment_requests_currency_check: ['length(currency)=3'],
  payment_requests_status_check: [
    'status',
    'pending',
    'payment_pending',
    'paid',
    'waived',
    'cancelled'
  ],
  payment_requests_charge_type_check: ['charge_type', 'direct'],
  payment_records_amount_minor_check: ['amount_minor>=0'],
  payment_records_currency_check: ['length(currency)=3'],
  payment_records_status_check: ['status', 'pending', 'settled', 'failed', 'voided', 'refunded'],
  stripe_webhook_events_stripe_event_id_check: ['length(stripe_event_id)>0'],
  stripe_webhook_events_event_type_check: ['length(event_type)>0'],
  checkin_records_status_check: ['status', 'checked_in', 'manual_review'],
  checkin_records_method_check: ['method', 'manual', 'search', 'qr'],
  audit_logs_action_check: ['length(action)>0'],
  audit_logs_target_type_check: ['length(target_type)>0'],
  outbox_events_type_check: ['type', 'discord.role_sync_requested', 'panel.refresh'],
  registrations_number_check: ['number>=0'],
  discord_panels_locale_check: ['locale', 'ja', 'en'],
  interaction_drafts_kind_check: ['kind', 'join', 'edit'],
  interaction_drafts_payload_check: ['json_valid', 'payload_json'],
  outbox_events_status_check: ['status', 'pending', 'processing', 'processed', 'failed'],
  outbox_events_attempts_check: ['attempts>=0']
};

const canonicalSql = (value: string): string =>
  value
    .toLowerCase()
    .replace(/["`]/g, '')
    .replace(/\b[a-z_]+\./g, '')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '');

const key = (
  table: string,
  columns: readonly string[],
  target = '',
  targetColumns: readonly string[] = [],
  onDelete = ''
) => [table, columns.join(','), target, targetColumns.join(','), onDelete].join('|');

describe('database schema parity', () => {
  let client: DatabaseClient;
  beforeEach(() => {
    client = testDatabase();
  });
  afterEach(() => {
    client.db.$client.close();
  });

  it('creates all application tables as STRICT tables', () => {
    const tables = client.db.$client
      .prepare(
        "select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name"
      )
      .all() as { name: string }[];
    expect(tables.map(({ name }) => name)).toEqual(expectedTables);
    const strict = client.db.$client.pragma('table_list') as { name: string; strict: number }[];
    for (const table of [...tables, { name: '__drizzle_migrations' }])
      expect(strict.find(({ name }) => name === table.name)?.strict, table.name).toBe(1);
  });

  it('preserves all unique constraints and partial unique predicates', () => {
    const indexes = loadIndexes(client);
    for (const [table, columns] of expectedUniqueConstraints) {
      expect(
        indexes.some(
          (index) =>
            index.table === table &&
            index.unique &&
            !index.partial &&
            index.columns.join(',') === columns.join(',')
        ),
        key(table, columns)
      ).toBe(true);
    }
    for (const [table, columns, predicate] of expectedPartialUniqueIndexes) {
      const index = indexes.find(
        (index) =>
          index.table === table &&
          index.unique &&
          index.partial &&
          index.columns.join(',') === columns.join(',')
      );
      expect(index, key(table, columns)).toBeDefined();
      expect(canonicalSql(index?.sql ?? '')).toContain(canonicalSql(predicate));
    }
  });

  it('preserves the complete composite foreign-key snapshot web', () => {
    const actual = new Set(
      loadForeignKeys(client).map((fk) => key(fk.table, fk.columns, fk.target, fk.targetColumns))
    );
    for (const [table, columns, target, targetColumns] of expectedCompositeForeignKeys) {
      expect(actual).toContain(key(table, columns, target, targetColumns));
    }
  });

  it('uses retention-safe delete actions', () => {
    const actual = new Set(
      loadForeignKeys(client).map((fk) =>
        key(fk.table, fk.columns, fk.target, fk.targetColumns, fk.onDelete)
      )
    );
    for (const [table, columns, target, targetColumns, onDelete] of expectedRetentionForeignKeys) {
      expect(actual).toContain(key(table, columns, target, targetColumns, onDelete));
    }
  });

  it('keeps every CHECK and its critical expression values', () => {
    const rows = client.db.$client
      .prepare("select sql from sqlite_schema where type = 'table'")
      .all() as { sql: string }[];
    const checks = new Map<string, string>();
    for (const { sql } of rows) {
      for (const match of sql.matchAll(/CONSTRAINT\s+["`]([^"`]+)["`]\s+CHECK\(([^\n]+)\)/g))
        checks.set(match[1], canonicalSql(match[2]));
    }
    expect([...checks.keys()].sort()).toEqual(Object.keys(checkFragments).sort());
    for (const [name, fragments] of Object.entries(checkFragments)) {
      for (const fragment of fragments)
        expect(checks.get(name), name).toContain(canonicalSql(fragment));
    }
  });

  it('stores money, timestamps, booleans and retry times as INTEGER and JSON as TEXT', () => {
    for (const table of expectedTables) {
      const columns = client.db.$client.pragma(`table_info('${table}')`) as {
        name: string;
        type: string;
        dflt_value: string | null;
      }[];
      for (const column of columns) {
        if (
          column.name.endsWith('_at') ||
          column.name === 'amount_minor' ||
          [
            'attempts',
            'required',
            'value_bool',
            'enabled',
            'charges_enabled',
            'payouts_enabled',
            'details_submitted'
          ].includes(column.name)
        )
          expect(column.type.toLowerCase(), `${table}.${column.name}`).toBe('integer');
        if (column.name.endsWith('_json')) expect(column.type.toLowerCase()).toBe('text');
      }
      if (table === 'outbox_events') {
        expect(columns.find(({ name }) => name === 'next_attempt_at')).toBeDefined();
        expect(columns.find(({ name }) => name === 'claimed_until')).toBeUndefined();
        expect(columns.find(({ name }) => name === 'attempts')?.dflt_value).toBe('0');
      }
    }
  });
});

function loadIndexes(client: DatabaseClient) {
  return expectedTables.flatMap((table) => {
    const indexes = client.db.$client.pragma(`index_list('${table}')`) as {
      name: string;
      unique: number;
      partial: number;
    }[];
    return indexes.map((index) => {
      const columns = client.db.$client.pragma(`index_info('${index.name}')`) as {
        seqno: number;
        name: string;
      }[];
      const definition = client.db.$client
        .prepare('select sql from sqlite_schema where name = ?')
        .get(index.name) as { sql: string | null };
      return {
        table,
        unique: index.unique === 1,
        partial: index.partial === 1,
        columns: columns.sort((a, b) => a.seqno - b.seqno).map(({ name }) => name),
        sql: definition.sql
      };
    });
  });
}

function loadForeignKeys(client: DatabaseClient) {
  return expectedTables.flatMap((table) => {
    const rows = client.db.$client.pragma(`foreign_key_list('${table}')`) as {
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }[];
    return [...new Set(rows.map(({ id }) => id))].map((id) => {
      const parts = rows.filter((row) => row.id === id).sort((a, b) => a.seq - b.seq);
      return {
        table,
        target: parts[0].table,
        columns: parts.map(({ from }) => from),
        targetColumns: parts.map(({ to }) => to),
        onDelete: parts[0].on_delete
      };
    });
  });
}
