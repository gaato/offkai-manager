import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';

const expectedTables = [
  'audit_logs',
  'campaigns',
  'checkin_records',
  'collection_payment_methods',
  'collections',
  'event_discord_integrations',
  'event_form_field_options',
  'event_form_fields',
  'events',
  'external_accounts',
  'orders',
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
  ['registrations', ['event_id', 'id']],
  ['stripe_connect_accounts', ['organization_id']],
  ['stripe_connect_accounts', ['stripe_account_id']],
  ['stripe_connect_accounts', ['organization_id', 'stripe_account_id']],
  ['campaigns', ['organization_id', 'slug']],
  ['campaigns', ['id', 'currency']],
  ['orders', ['access_token']],
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
  ['registrations', ['event_id', 'user_id'], "status <> 'cancelled'"],
  ['payment_records', ['idempotency_key'], "idempotency_key <> ''"],
  ['payment_requests', ['checkout_session_id'], "checkout_session_id <> ''"],
  ['payment_requests', ['payment_intent_id'], "payment_intent_id <> ''"],
  ['orders', ['checkout_session_id'], "checkout_session_id <> ''"],
  ['orders', ['payment_intent_id'], "payment_intent_id <> ''"]
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
  ['checkin_records', ['event_id', 'registration_id'], 'registrations', ['event_id', 'id']],
  ['orders', ['campaign_id', 'currency'], 'campaigns', ['id', 'currency']]
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
  ['payment_requests', ['registration_id'], 'registrations', ['id'], 'NO ACTION'],
  ['orders', ['user_id'], 'users', ['id'], 'SET NULL']
] as const;

const checkFragments: Readonly<Record<string, readonly string[]>> = {
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
  campaigns_title_check: ['length(title)>0'],
  campaigns_slug_check: ['length(slug)>0'],
  campaigns_unit_price_minor_check: ['unit_price_minor>0'],
  campaigns_goal_minor_check: ['goal_minor>=0'],
  campaigns_max_units_per_pledge_check: ['max_units_per_pledge>=1'],
  campaigns_currency_check: ['length(currency)=3'],
  campaigns_status_check: ['status', 'draft', 'open', 'closed', 'archived'],
  orders_display_name_check: ['length(display_name)>0'],
  orders_unit_count_check: ['unit_count>=1'],
  orders_unit_price_minor_check: ['unit_price_minor>0'],
  orders_amount_minor_check: ['amount_minor=unit_price_minor*unit_count'],
  orders_currency_check: ['length(currency)=3'],
  orders_status_check: ['status', 'pending', 'payment_pending', 'paid', 'expired', 'cancelled'],
  orders_access_token_check: ['length(access_token)>=32'],
  orders_payment_pending_session_check: ["status<>'payment_pending'", "checkout_session_id<>''"],
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
    'pending_external_creation',
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
  outbox_events_type_check: [
    'type',
    'discord.role_sync_requested',
    'notification.payment_requested',
    'stripe.checkout_session_create_requested',
    'payment.reconciliation_requested'
  ],
  outbox_events_status_check: ['status', 'pending', 'processed', 'failed'],
  outbox_events_attempts_check: ['attempts>=0']
};

interface ConstraintRow {
  tableName: string;
  referencedTableName: string;
  columns: string[];
  referencedColumns: string[];
  deleteAction: string;
}

interface IndexRow {
  tableName: string;
  columns: string[];
  predicate: string | null;
  isUnique: boolean;
  accessMethod: string;
  definition: string;
}

const canonicalSql = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll('"', '')
    .replace(/::(?:text|integer|bigint)/g, '')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '');

const constraintKey = (
  tableName: string,
  columns: readonly string[],
  referencedTableName = '',
  referencedColumns: readonly string[] = [],
  deleteAction = ''
): string =>
  [
    tableName,
    columns.join(','),
    referencedTableName,
    referencedColumns.join(','),
    deleteAction
  ].join('|');

describe('database schema parity', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'schema-parity-session-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  it('creates the complete 22-table schema with pgcrypto', async () => {
    const tables = await client.sql<{ tableName: string }[]>`
      select table_name as "tableName"
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `;
    const extensions = await client.sql<{ extensionName: string }[]>`
      select extname as "extensionName" from pg_extension
    `;

    expect(tables.map(({ tableName }) => tableName)).toEqual(expectedTables);
    expect(extensions.map(({ extensionName }) => extensionName)).toContain('pgcrypto');
  });

  it('preserves all unique constraints and partial unique predicates', async () => {
    const constraints = await client.sql<{ tableName: string; columns: string[] }[]>`
      select
        relation.relname as "tableName",
        array(
          select attribute.attname
          from unnest(constraint_row.conkey) with ordinality as key(attnum, position)
          join pg_attribute as attribute
            on attribute.attrelid = constraint_row.conrelid
           and attribute.attnum = key.attnum
          order by key.position
        ) as columns
      from pg_constraint as constraint_row
      join pg_class as relation on relation.oid = constraint_row.conrelid
      join pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and constraint_row.contype = 'u'
    `;
    const actualConstraints = new Set(
      constraints.map(({ tableName, columns }) => constraintKey(tableName, columns))
    );
    for (const [tableName, columns] of expectedUniqueConstraints) {
      expect(actualConstraints, `${tableName} UNIQUE (${columns.join(', ')})`).toContain(
        constraintKey(tableName, columns)
      );
    }

    const indexes = await loadIndexes(client);
    for (const [tableName, columns, predicate] of expectedPartialUniqueIndexes) {
      const match = indexes.find(
        (index) =>
          index.tableName === tableName &&
          index.isUnique &&
          index.columns.join(',') === columns.join(',')
      );
      expect(match, `${tableName} partial UNIQUE (${columns.join(', ')})`).toBeDefined();
      expect(canonicalSql(match?.predicate ?? '')).toContain(canonicalSql(predicate));
    }
  });

  it('preserves the complete composite foreign-key snapshot web', async () => {
    const foreignKeys = await loadForeignKeys(client);
    const actual = new Set(
      foreignKeys.map((foreignKey) =>
        constraintKey(
          foreignKey.tableName,
          foreignKey.columns,
          foreignKey.referencedTableName,
          foreignKey.referencedColumns
        )
      )
    );

    for (const [
      tableName,
      columns,
      referencedTable,
      referencedColumns
    ] of expectedCompositeForeignKeys) {
      expect(
        actual,
        `${tableName} (${columns.join(', ')}) -> ${referencedTable} (${referencedColumns.join(', ')})`
      ).toContain(constraintKey(tableName, columns, referencedTable, referencedColumns));
    }
  });

  it('uses retention-safe delete actions instead of legacy cascades', async () => {
    const foreignKeys = await loadForeignKeys(client);
    const actual = new Set(
      foreignKeys.map((foreignKey) =>
        constraintKey(
          foreignKey.tableName,
          foreignKey.columns,
          foreignKey.referencedTableName,
          foreignKey.referencedColumns,
          foreignKey.deleteAction
        )
      )
    );

    for (const [
      tableName,
      columns,
      referencedTable,
      referencedColumns,
      deleteAction
    ] of expectedRetentionForeignKeys) {
      expect(actual).toContain(
        constraintKey(tableName, columns, referencedTable, referencedColumns, deleteAction)
      );
    }
  });

  it('keeps every legacy check constraint with its critical expression values', async () => {
    const checks = await client.sql<{ constraintName: string; definition: string }[]>`
      select
        constraint_row.conname as "constraintName",
        pg_get_constraintdef(constraint_row.oid, true) as definition
      from pg_constraint as constraint_row
      join pg_class as relation on relation.oid = constraint_row.conrelid
      join pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and constraint_row.contype = 'c'
    `;
    const actual = new Map(
      checks.map(({ constraintName, definition }) => [constraintName, canonicalSql(definition)])
    );

    expect([...actual.keys()].sort()).toEqual(Object.keys(checkFragments).sort());
    for (const [constraintName, fragments] of Object.entries(checkFragments)) {
      const definition = actual.get(constraintName);
      expect(definition, constraintName).toBeDefined();
      for (const fragment of fragments) {
        expect(definition, `${constraintName}: ${fragment}`).toContain(canonicalSql(fragment));
      }
    }
  });

  it('uses GIN simple-text search, bigint money, timestamptz, and outbox lease columns', async () => {
    const indexes = await loadIndexes(client);
    const searchIndex = indexes.find(
      (index) =>
        index.tableName === 'registrations' &&
        index.accessMethod === 'gin' &&
        index.definition.includes("to_tsvector('simple'::regconfig, search_text)")
    );
    expect(searchIndex).toBeDefined();

    const columns = await client.sql<
      {
        tableName: string;
        columnName: string;
        dataType: string;
        defaultValue: string | null;
        isNullable: string;
      }[]
    >`
      select
        table_name as "tableName",
        column_name as "columnName",
        data_type as "dataType",
        column_default as "defaultValue",
        is_nullable as "isNullable"
      from information_schema.columns
      where table_schema = 'public'
    `;
    const byName = new Map(
      columns.map((column) => [`${column.tableName}.${column.columnName}`, column])
    );

    for (const tableName of ['collections', 'payment_requests', 'payment_records']) {
      expect(byName.get(`${tableName}.amount_minor`)?.dataType).toBe('bigint');
    }
    for (const columnName of ['unit_price_minor', 'goal_minor']) {
      expect(byName.get(`campaigns.${columnName}`)?.dataType).toBe('bigint');
    }
    for (const columnName of ['unit_price_minor', 'amount_minor']) {
      expect(byName.get(`orders.${columnName}`)?.dataType).toBe('bigint');
    }
    expect(byName.get('orders.list_publicly')?.defaultValue).toBe('false');
    expect(byName.get('orders.campaign_id')?.isNullable).toBe('NO');
    expect(byName.get('campaigns.fulfillment_date')?.dataType).toBe('date');
    expect(byName.get('campaigns.completion_report_text')?.isNullable).toBe('YES');
    expect(byName.get('campaigns.completion_report_text')?.dataType).toBe('text');
    expect(byName.get('campaigns.completion_reported_at')?.isNullable).toBe('YES');
    for (const column of columns.filter(({ dataType }) => dataType.startsWith('timestamp'))) {
      expect(column.dataType, `${column.tableName}.${column.columnName}`).toBe(
        'timestamp with time zone'
      );
    }
    expect(byName.get('outbox_events.claimed_until')?.dataType).toBe('timestamp with time zone');
    expect(byName.get('outbox_events.attempts')?.dataType).toBe('integer');
    expect(byName.get('outbox_events.attempts')?.defaultValue).toBe('0');
  });
});

async function loadForeignKeys(client: DatabaseClient): Promise<ConstraintRow[]> {
  return client.sql<ConstraintRow[]>`
    select
      relation.relname as "tableName",
      referenced_relation.relname as "referencedTableName",
      array(
        select attribute.attname
        from unnest(constraint_row.conkey) with ordinality as key(attnum, position)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key.attnum
        order by key.position
      ) as columns,
      array(
        select attribute.attname
        from unnest(constraint_row.confkey) with ordinality as key(attnum, position)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_row.confrelid
         and attribute.attnum = key.attnum
        order by key.position
      ) as "referencedColumns",
      case constraint_row.confdeltype
        when 'a' then 'NO ACTION'
        when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'
        when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT'
      end as "deleteAction"
    from pg_constraint as constraint_row
    join pg_class as relation on relation.oid = constraint_row.conrelid
    join pg_class as referenced_relation on referenced_relation.oid = constraint_row.confrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and constraint_row.contype = 'f'
  `;
}

async function loadIndexes(client: DatabaseClient): Promise<IndexRow[]> {
  return client.sql<IndexRow[]>`
    select
      relation.relname as "tableName",
      array(
        select pg_get_indexdef(index_row.indexrelid, position, true)
        from generate_series(1, index_row.indnkeyatts) as position
        order by position
      ) as columns,
      pg_get_expr(index_row.indpred, index_row.indrelid) as predicate,
      index_row.indisunique as "isUnique",
      access_method.amname as "accessMethod",
      pg_get_indexdef(index_row.indexrelid) as definition
    from pg_index as index_row
    join pg_class as relation on relation.oid = index_row.indrelid
    join pg_class as index_relation on index_relation.oid = index_row.indexrelid
    join pg_am as access_method on access_method.oid = index_relation.relam
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
  `;
}
