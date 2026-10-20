import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'bigint' }).notNull();

export const users = pgTable('users', {
  id: id(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true })
});

export const externalAccounts = pgTable(
  'external_accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    username: text('username').notNull().default(''),
    displayName: text('display_name').notNull().default(''),
    avatarUrl: text('avatar_url').notNull().default(''),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique('external_accounts_provider_provider_user_id_key').on(
      table.provider,
      table.providerUserId
    ),
    check('external_accounts_provider_check', sql`${table.provider} in ('discord')`)
  ]
);

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true })
  },
  (table) => [
    unique('organizations_slug_key').on(table.slug),
    check('organizations_name_check', sql`length(${table.name}) > 0`),
    check('organizations_slug_check', sql`length(${table.slug}) > 0`),
    index('organizations_suspended_at_idx')
      .on(table.suspendedAt)
      .where(sql`${table.suspendedAt} is not null`)
  ]
);

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('organization_memberships_organization_id_user_id_key').on(
      table.organizationId,
      table.userId
    ),
    check(
      'organization_memberships_role_check',
      sql`${table.role} in ('owner', 'organizer', 'staff', 'viewer')`
    ),
    check('organization_memberships_status_check', sql`${table.status} in ('active', 'disabled')`),
    index('organization_memberships_user_idx').on(table.userId),
    index('organization_memberships_organization_status_idx').on(table.organizationId, table.status)
  ]
);

export const events = pgTable(
  'events',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity'),
    visibility: text('visibility').notNull(),
    discordPolicy: text('discord_policy').notNull(),
    registrationOpensAt: timestamp('registration_opens_at', { withTimezone: true }).notNull(),
    registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }).notNull(),
    venueName: text('venue_name').notNull().default(''),
    venueAddress: text('venue_address').notNull().default(''),
    venueReveal: text('venue_reveal').notNull().default('public'),
    contact: text('contact').notNull().default(''),
    cancellationPolicy: text('cancellation_policy').notNull().default(''),
    registrationMode: text('registration_mode').notNull().default('auto_confirm'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('events_organization_id_slug_key').on(table.organizationId, table.slug),
    check('events_title_check', sql`length(${table.title}) > 0`),
    check('events_slug_check', sql`length(${table.slug}) > 0`),
    check('events_ends_at_check', sql`${table.endsAt} > ${table.startsAt}`),
    check('events_capacity_check', sql`${table.capacity} >= 0`),
    check('events_visibility_check', sql`${table.visibility} in ('draft', 'public', 'unlisted')`),
    check(
      'events_discord_policy_check',
      sql`${table.discordPolicy} in ('not_used', 'optional', 'login_required', 'guild_join_required')`
    ),
    check('events_venue_reveal_check', sql`${table.venueReveal} in ('public', 'confirmed')`),
    check(
      'events_registration_mode_check',
      sql`${table.registrationMode} in ('auto_confirm', 'approval')`
    ),
    index('events_archived_at_idx').on(table.archivedAt)
  ]
);

export const eventDiscordIntegrations = pgTable(
  'event_discord_integrations',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull().default(''),
    guildNameSnapshot: text('guild_name_snapshot').notNull().default(''),
    inviteUrl: text('invite_url').notNull().default(''),
    announcementChannelId: text('announcement_channel_id').notNull().default(''),
    staffChannelId: text('staff_channel_id').notNull().default(''),
    roleId: text('role_id').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [unique('event_discord_integrations_event_id_key').on(table.eventId)]
);

export const eventFormFields = pgTable(
  'event_form_fields',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull().default(0),
    helpText: text('help_text').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('event_form_fields_event_id_field_key_key').on(table.eventId, table.fieldKey),
    unique('event_form_fields_event_id_id_key').on(table.eventId, table.id),
    check('event_form_fields_field_key_check', sql`length(${table.fieldKey}) > 0`),
    check('event_form_fields_label_check', sql`length(${table.label}) > 0`),
    check(
      'event_form_fields_field_type_check',
      sql`${table.fieldType} in ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'consent')`
    ),
    index('event_form_fields_event_position_idx').on(table.eventId, table.position)
  ]
);

export const eventFormFieldOptions = pgTable(
  'event_form_field_options',
  {
    id: id(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => eventFormFields.id, { onDelete: 'cascade' }),
    optionKey: text('option_key').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('event_form_field_options_field_id_option_key_key').on(table.fieldId, table.optionKey),
    unique('event_form_field_options_field_id_id_key').on(table.fieldId, table.id),
    check('event_form_field_options_option_key_check', sql`length(${table.optionKey}) > 0`),
    check('event_form_field_options_label_check', sql`length(${table.label}) > 0`),
    index('event_form_field_options_field_position_idx').on(table.fieldId, table.position)
  ]
);

export const registrations = pgTable(
  'registrations',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(),
    displayNameSnapshot: text('display_name_snapshot').notNull(),
    searchText: text('search_text').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('registrations_event_id_id_key').on(table.eventId, table.id),
    uniqueIndex('registrations_one_active_per_user_event')
      .on(table.eventId, table.userId)
      .where(sql`${table.status} <> 'cancelled'`),
    index('registrations_event_status_idx').on(table.eventId, table.status),
    index('registrations_event_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.searchText})`
    ),
    check(
      'registrations_status_check',
      sql`${table.status} in ('applied', 'confirmed', 'waitlisted', 'cancelled')`
    ),
    check(
      'registrations_display_name_snapshot_check',
      sql`length(${table.displayNameSnapshot}) > 0`
    )
  ]
);

export const registrationFormAnswers = pgTable(
  'registration_form_answers',
  {
    id: id(),
    eventId: uuid('event_id').notNull(),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => eventFormFields.id),
    fieldKeySnapshot: text('field_key_snapshot').notNull(),
    fieldLabelSnapshot: text('field_label_snapshot').notNull(),
    fieldTypeSnapshot: text('field_type_snapshot').notNull(),
    valueText: text('value_text').notNull().default(''),
    valueBool: boolean('value_bool'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('registration_form_answers_registration_id_field_id_key').on(
      table.registrationId,
      table.fieldId
    ),
    unique('registration_form_answers_id_field_id_key').on(table.id, table.fieldId),
    foreignKey({
      name: 'registration_form_answers_event_registration_fkey',
      columns: [table.eventId, table.registrationId],
      foreignColumns: [registrations.eventId, registrations.id]
    }),
    foreignKey({
      name: 'registration_form_answers_event_field_fkey',
      columns: [table.eventId, table.fieldId],
      foreignColumns: [eventFormFields.eventId, eventFormFields.id]
    }),
    check(
      'registration_form_answers_field_key_snapshot_check',
      sql`length(${table.fieldKeySnapshot}) > 0`
    ),
    check(
      'registration_form_answers_field_label_snapshot_check',
      sql`length(${table.fieldLabelSnapshot}) > 0`
    ),
    check(
      'registration_form_answers_field_type_snapshot_check',
      sql`${table.fieldTypeSnapshot} in ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'consent')`
    ),
    index('registration_form_answers_registration_idx').on(table.registrationId),
    index('registration_form_answers_field_idx').on(table.fieldId),
    index('registration_form_answers_event_idx').on(table.eventId)
  ]
);

export const registrationFormAnswerOptions = pgTable(
  'registration_form_answer_options',
  {
    answerId: uuid('answer_id')
      .notNull()
      .references(() => registrationFormAnswers.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id').notNull(),
    optionId: uuid('option_id')
      .notNull()
      .references(() => eventFormFieldOptions.id),
    optionKeySnapshot: text('option_key_snapshot').notNull(),
    optionLabelSnapshot: text('option_label_snapshot').notNull()
  },
  (table) => [
    primaryKey({
      name: 'registration_form_answer_options_pkey',
      columns: [table.answerId, table.optionId]
    }),
    foreignKey({
      name: 'registration_form_answer_options_answer_field_fkey',
      columns: [table.answerId, table.fieldId],
      foreignColumns: [registrationFormAnswers.id, registrationFormAnswers.fieldId]
    }),
    foreignKey({
      name: 'registration_form_answer_options_field_option_fkey',
      columns: [table.fieldId, table.optionId],
      foreignColumns: [eventFormFieldOptions.fieldId, eventFormFieldOptions.id]
    }),
    check(
      'registration_form_answer_options_option_key_snapshot_check',
      sql`length(${table.optionKeySnapshot}) > 0`
    ),
    check(
      'registration_form_answer_options_option_label_snapshot_check',
      sql`length(${table.optionLabelSnapshot}) > 0`
    ),
    index('registration_form_answer_options_option_idx').on(table.optionId)
  ]
);

export const stripeConnectAccounts = pgTable(
  'stripe_connect_accounts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stripeAccountId: text('stripe_account_id').notNull(),
    dashboardType: text('dashboard_type').notNull(),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),
    onboardingStatus: text('onboarding_status').notNull(),
    country: text('country').notNull().default(''),
    defaultCurrency: text('default_currency').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('stripe_connect_accounts_organization_id_key').on(table.organizationId),
    unique('stripe_connect_accounts_stripe_account_id_key').on(table.stripeAccountId),
    unique('stripe_connect_accounts_organization_id_stripe_account_id_key').on(
      table.organizationId,
      table.stripeAccountId
    ),
    check(
      'stripe_connect_accounts_stripe_account_id_check',
      sql`length(${table.stripeAccountId}) > 0`
    ),
    check(
      'stripe_connect_accounts_dashboard_type_check',
      sql`${table.dashboardType} in ('express', 'full', 'none')`
    ),
    check(
      'stripe_connect_accounts_onboarding_status_check',
      sql`${table.onboardingStatus} in ('not_connected', 'onboarding_required', 'pending_verification', 'ready', 'disabled')`
    )
  ]
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    unitPriceMinor: money('unit_price_minor'),
    currency: text('currency').notNull(),
    goalMinor: money('goal_minor'),
    maxUnitsPerPledge: integer('max_units_per_pledge').notNull().default(10),
    fulfillmentDate: date('fulfillment_date', { mode: 'string' }),
    fulfillmentNote: text('fulfillment_note').notNull().default(''),
    contact: text('contact').notNull().default(''),
    completionReportText: text('completion_report_text'),
    completionReportedAt: timestamp('completion_reported_at', { withTimezone: true }),
    status: text('status').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('campaigns_organization_id_slug_key').on(table.organizationId, table.slug),
    unique('campaigns_id_currency_key').on(table.id, table.currency),
    check('campaigns_title_check', sql`length(${table.title}) > 0`),
    check('campaigns_slug_check', sql`length(${table.slug}) > 0`),
    check('campaigns_unit_price_minor_check', sql`${table.unitPriceMinor} > 0`),
    check('campaigns_goal_minor_check', sql`${table.goalMinor} >= 0`),
    check('campaigns_max_units_per_pledge_check', sql`${table.maxUnitsPerPledge} >= 1`),
    check('campaigns_currency_check', sql`length(${table.currency}) = 3`),
    check(
      'campaigns_status_check',
      sql`${table.status} in ('draft', 'open', 'closed', 'archived')`
    ),
    index('campaigns_organization_idx').on(table.organizationId)
  ]
);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    listPublicly: boolean('list_publicly').notNull().default(false),
    unitCount: integer('unit_count').notNull(),
    unitPriceMinor: money('unit_price_minor'),
    amountMinor: money('amount_minor'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    accessToken: text('access_token').notNull(),
    stripeAccountId: text('stripe_account_id').notNull().default(''),
    checkoutSessionId: text('checkout_session_id').notNull().default(''),
    paymentIntentId: text('payment_intent_id').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('orders_access_token_key').on(table.accessToken),
    uniqueIndex('orders_checkout_session_id_key')
      .on(table.checkoutSessionId)
      .where(sql`${table.checkoutSessionId} <> ''`),
    uniqueIndex('orders_payment_intent_id_key')
      .on(table.paymentIntentId)
      .where(sql`${table.paymentIntentId} <> ''`),
    foreignKey({
      name: 'orders_campaign_currency_fkey',
      columns: [table.campaignId, table.currency],
      foreignColumns: [campaigns.id, campaigns.currency]
    }),
    check('orders_display_name_check', sql`length(${table.displayName}) > 0`),
    check('orders_unit_count_check', sql`${table.unitCount} >= 1`),
    check('orders_unit_price_minor_check', sql`${table.unitPriceMinor} > 0`),
    check(
      'orders_amount_minor_check',
      sql`${table.amountMinor} = ${table.unitPriceMinor} * ${table.unitCount}`
    ),
    check('orders_currency_check', sql`length(${table.currency}) = 3`),
    check(
      'orders_status_check',
      sql`${table.status} in ('pending', 'payment_pending', 'paid', 'expired', 'cancelled')`
    ),
    check('orders_access_token_check', sql`length(${table.accessToken}) >= 32`),
    check(
      'orders_payment_pending_session_check',
      sql`${table.status} <> 'payment_pending' or ${table.checkoutSessionId} <> ''`
    ),
    index('orders_campaign_status_idx').on(table.campaignId, table.status)
  ]
);

export const collections = pgTable(
  'collections',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    amountMinor: money('amount_minor'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    instructions: text('instructions').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('collections_event_id_id_key').on(table.eventId, table.id),
    unique('collections_id_currency_key').on(table.id, table.currency),
    check('collections_title_check', sql`length(${table.title}) > 0`),
    check('collections_amount_minor_check', sql`${table.amountMinor} >= 0`),
    check('collections_currency_check', sql`length(${table.currency}) = 3`),
    check(
      'collections_status_check',
      sql`${table.status} in ('draft', 'open', 'closed', 'archived')`
    ),
    index('collections_event_idx').on(table.eventId)
  ]
);

export const collectionPaymentMethods = pgTable(
  'collection_payment_methods',
  {
    id: id(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    timing: text('timing').notNull().default('onsite'),
    confirmation: text('confirmation').notNull().default('manual'),
    instructions: text('instructions').notNull().default('')
  },
  (table) => [
    unique('collection_payment_methods_collection_id_label_key').on(
      table.collectionId,
      table.label
    ),
    unique('collection_payment_methods_collection_id_id_key').on(table.collectionId, table.id),
    check('collection_payment_methods_label_check', sql`length(${table.label}) > 0`),
    check(
      'collection_payment_methods_timing_check',
      sql`${table.timing} in ('advance', 'onsite', 'none')`
    ),
    check(
      'collection_payment_methods_confirmation_check',
      sql`${table.confirmation} in ('internal', 'manual', 'none')`
    )
  ]
);

export const paymentRequests = pgTable(
  'payment_requests',
  {
    id: id(),
    eventId: uuid('event_id').notNull(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id),
    collectionPaymentMethodId: uuid('collection_payment_method_id')
      .notNull()
      .references(() => collectionPaymentMethods.id),
    amountMinor: money('amount_minor'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    stripeAccountId: text('stripe_account_id').notNull().default(''),
    checkoutSessionId: text('checkout_session_id').notNull().default(''),
    paymentIntentId: text('payment_intent_id').notNull().default(''),
    chargeType: text('charge_type').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('payment_requests_collection_id_registration_id_key').on(
      table.collectionId,
      table.registrationId
    ),
    unique('payment_requests_id_registration_id_key').on(table.id, table.registrationId),
    unique('payment_requests_id_collection_id_key').on(table.id, table.collectionId),
    uniqueIndex('payment_requests_checkout_session_id_key')
      .on(table.checkoutSessionId)
      .where(sql`${table.checkoutSessionId} <> ''`),
    uniqueIndex('payment_requests_payment_intent_id_key')
      .on(table.paymentIntentId)
      .where(sql`${table.paymentIntentId} <> ''`),
    foreignKey({
      name: 'payment_requests_event_collection_fkey',
      columns: [table.eventId, table.collectionId],
      foreignColumns: [collections.eventId, collections.id]
    }),
    foreignKey({
      name: 'payment_requests_event_registration_fkey',
      columns: [table.eventId, table.registrationId],
      foreignColumns: [registrations.eventId, registrations.id]
    }),
    foreignKey({
      name: 'payment_requests_collection_method_fkey',
      columns: [table.collectionId, table.collectionPaymentMethodId],
      foreignColumns: [collectionPaymentMethods.collectionId, collectionPaymentMethods.id]
    }),
    foreignKey({
      name: 'payment_requests_collection_currency_fkey',
      columns: [table.collectionId, table.currency],
      foreignColumns: [collections.id, collections.currency]
    }),
    check('payment_requests_amount_minor_check', sql`${table.amountMinor} >= 0`),
    check('payment_requests_currency_check', sql`length(${table.currency}) = 3`),
    check(
      'payment_requests_status_check',
      sql`${table.status} in ('pending', 'pending_external_creation', 'payment_pending', 'paid', 'waived', 'cancelled')`
    ),
    check('payment_requests_charge_type_check', sql`${table.chargeType} in ('', 'direct')`),
    index('payment_requests_registration_idx').on(table.registrationId),
    index('payment_requests_collection_status_idx').on(table.collectionId, table.status),
    index('payment_requests_event_status_idx').on(table.eventId, table.status)
  ]
);

export const paymentRecords = pgTable(
  'payment_records',
  {
    id: id(),
    paymentRequestId: uuid('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id),
    collectionId: uuid('collection_id').notNull(),
    collectionPaymentMethodId: uuid('collection_payment_method_id')
      .notNull()
      .references(() => collectionPaymentMethods.id),
    externalReference: text('external_reference').notNull().default(''),
    note: text('note').notNull().default(''),
    amountMinor: money('amount_minor'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    rawPayloadJson: jsonb('raw_payload_json'),
    idempotencyKey: text('idempotency_key').notNull().default(''),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('payment_records_idempotency_key_idx')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} <> ''`),
    foreignKey({
      name: 'payment_records_request_registration_fkey',
      columns: [table.paymentRequestId, table.registrationId],
      foreignColumns: [paymentRequests.id, paymentRequests.registrationId]
    }),
    foreignKey({
      name: 'payment_records_request_collection_fkey',
      columns: [table.paymentRequestId, table.collectionId],
      foreignColumns: [paymentRequests.id, paymentRequests.collectionId]
    }),
    foreignKey({
      name: 'payment_records_collection_method_fkey',
      columns: [table.collectionId, table.collectionPaymentMethodId],
      foreignColumns: [collectionPaymentMethods.collectionId, collectionPaymentMethods.id]
    }),
    check('payment_records_amount_minor_check', sql`${table.amountMinor} >= 0`),
    check('payment_records_currency_check', sql`length(${table.currency}) = 3`),
    check(
      'payment_records_status_check',
      sql`${table.status} in ('pending', 'settled', 'failed', 'voided', 'refunded')`
    ),
    index('payment_records_request_idx').on(table.paymentRequestId),
    index('payment_records_registration_idx').on(table.registrationId),
    index('payment_records_collection_idx').on(table.collectionId)
  ]
);

export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: id(),
    stripeEventId: text('stripe_event_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull().default(''),
    eventType: text('event_type').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (table) => [
    unique('stripe_webhook_events_stripe_event_id_key').on(table.stripeEventId),
    check('stripe_webhook_events_stripe_event_id_check', sql`length(${table.stripeEventId}) > 0`),
    check('stripe_webhook_events_event_type_check', sql`length(${table.eventType}) > 0`)
  ]
);

export const checkinRecords = pgTable(
  'checkin_records',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull(),
    method: text('method').notNull(),
    clientMetadata: text('client_metadata').notNull().default(''),
    createdAt: createdAt()
  },
  (table) => [
    foreignKey({
      name: 'checkin_records_event_registration_fkey',
      columns: [table.eventId, table.registrationId],
      foreignColumns: [registrations.eventId, registrations.id]
    }),
    check('checkin_records_status_check', sql`${table.status} in ('checked_in', 'manual_review')`),
    check('checkin_records_method_check', sql`${table.method} in ('manual', 'search', 'qr')`),
    index('checkin_records_event_idx').on(table.eventId, table.createdAt.desc()),
    index('checkin_records_registration_idx').on(table.registrationId)
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    reason: text('reason').notNull().default(''),
    metadataJson: jsonb('metadata_json'),
    createdAt: createdAt()
  },
  (table) => [
    check('audit_logs_action_check', sql`length(${table.action}) > 0`),
    check('audit_logs_target_type_check', sql`length(${table.targetType}) > 0`),
    index('audit_logs_event_created_idx').on(table.eventId, table.createdAt.desc()),
    index('audit_logs_target_idx').on(table.targetType, table.targetId)
  ]
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    type: text('type').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error').notNull().default(''),
    claimedUntil: timestamp('claimed_until', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (table) => [
    check(
      'outbox_events_type_check',
      sql`${table.type} in ('discord.role_sync_requested', 'notification.payment_requested', 'stripe.checkout_session_create_requested', 'payment.reconciliation_requested')`
    ),
    check('outbox_events_status_check', sql`${table.status} in ('pending', 'processed', 'failed')`),
    check('outbox_events_attempts_check', sql`${table.attempts} >= 0`),
    index('outbox_events_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    index('outbox_events_claimable_idx')
      .on(table.type, table.createdAt)
      .where(sql`${table.status} = 'pending'`)
  ]
);
