import { desc, sql } from 'drizzle-orm';
import {
  customType,
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  primaryKey,
  text,
  unique,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);
// Reject amounts that Number cannot represent exactly before binding them to SQLite.
export const bigintInteger = customType<{ data: bigint; driverData: number }>({
  dataType: () => 'integer',
  toDriver: (value) => {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('Money amount is outside the safe integer range');
    }
    return Number(value);
  },
  fromDriver: (value) => BigInt(value)
});
const money = (name: string) => bigintInteger(name).notNull();

export const users = sqliteTable('users', {
  id: id(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  suspendedAt: integer('suspended_at', { mode: 'timestamp_ms' })
});

export const externalAccounts = sqliteTable(
  'external_accounts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    username: text('username').notNull().default(''),
    displayName: text('display_name').notNull().default(''),
    avatarUrl: text('avatar_url').notNull().default(''),
    linkedAt: integer('linked_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
  },
  (table) => [
    unique('external_accounts_provider_provider_user_id_key').on(
      table.provider,
      table.providerUserId
    ),
    check('external_accounts_provider_check', sql`${table.provider} in ('discord')`)
  ]
);

export const organizations = sqliteTable(
  'organizations',
  {
    id: id(),
    disclosureJson: text('disclosure_json', { mode: 'json' }).$type<unknown>(),
    personalOwnerUserId: text('personal_owner_user_id').references(() => users.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    suspendedAt: integer('suspended_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    unique('organizations_slug_key').on(table.slug),
    uniqueIndex('organizations_personal_owner_key')
      .on(table.personalOwnerUserId)
      .where(sql`${table.personalOwnerUserId} is not null`),
    check('organizations_name_check', sql`length(${table.name}) > 0`),
    check('organizations_slug_check', sql`length(${table.slug}) > 0`),
    index('organizations_suspended_at_idx')
      .on(table.suspendedAt)
      .where(sql`${table.suspendedAt} is not null`)
  ]
);

export const organizationMemberships = sqliteTable(
  'organization_memberships',
  {
    id: id(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    invitedByUserId: text('invited_by_user_id').references(() => users.id),
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

export const events = sqliteTable(
  'events',
  {
    id: id(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
    capacity: integer('capacity'),
    visibility: text('visibility').notNull(),
    discordPolicy: text('discord_policy').notNull(),
    registrationOpensAt: integer('registration_opens_at', { mode: 'timestamp_ms' }).notNull(),
    registrationClosesAt: integer('registration_closes_at', { mode: 'timestamp_ms' }).notNull(),
    venueName: text('venue_name').notNull().default(''),
    venueAddress: text('venue_address').notNull().default(''),
    venueReveal: text('venue_reveal').notNull().default('public'),
    contact: text('contact').notNull().default(''),
    cancellationPolicy: text('cancellation_policy').notNull().default(''),
    registrationMode: text('registration_mode').notNull().default('auto_confirm'),
    paymentRequirement: text('payment_requirement').notNull().default('none'),
    paymentOpensAt: integer('payment_opens_at', { mode: 'timestamp_ms' }),
    paymentDueAt: integer('payment_due_at', { mode: 'timestamp_ms' }),
    additionalOpensAt: integer('additional_opens_at', { mode: 'timestamp_ms' }),
    platformFeeBps: integer('platform_fee_bps').notNull().default(0),
    amountToCollectMinor: money('amount_to_collect_minor').default(sql`0`),
    roundingUnit: integer('rounding_unit').notNull().default(1),
    holdMinutes: integer('hold_minutes').notNull().default(30),
    panelTemplateJa: text('panel_template_ja').notNull().default(''),
    panelTemplateEn: text('panel_template_en').notNull().default(''),
    panelTemplateReviewedAt: integer('panel_template_reviewed_at', { mode: 'timestamp_ms' }),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('events_organization_id_slug_key').on(table.organizationId, table.slug),
    check(
      'events_payment_requirement_check',
      sql`${table.paymentRequirement} in ('none', 'pay_to_confirm', 'pay_later')`
    ),
    check(
      'events_platform_fee_bps_check',
      sql`${table.platformFeeBps} >= 0 and ${table.platformFeeBps} < 10000`
    ),
    check('events_amount_to_collect_minor_check', sql`${table.amountToCollectMinor} >= 0`),
    check('events_rounding_unit_check', sql`${table.roundingUnit} > 0`),
    check(
      'events_hold_minutes_check',
      sql`${table.holdMinutes} >= 30 and ${table.holdMinutes} <= 1440`
    ),
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

export const eventDiscordIntegrations = sqliteTable(
  'event_discord_integrations',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull().default(''),
    guildNameSnapshot: text('guild_name_snapshot').notNull().default(''),
    inviteUrl: text('invite_url').notNull().default(''),
    announcementChannelId: text('announcement_channel_id').notNull().default(''),
    staffChannelId: text('staff_channel_id').notNull().default(''),
    staffRoleId: text('staff_role_id').notNull().default(''),
    notificationChannelId: text('notification_channel_id').notNull().default(''),
    roleId: text('role_id').notNull().default(''),
    paidRoleId: text('paid_role_id').notNull().default(''),
    questionsChannelId: text('questions_channel_id').notNull().default(''),
    scheduledEnabled: integer('scheduled_enabled', { mode: 'boolean' }).notNull().default(false),
    scheduledStateJson: text('scheduled_state_json', { mode: 'json' }).$type<unknown>(),
    layoutClaim: text('layout_claim').notNull().default(''),
    layoutClaimedAt: integer('layout_claimed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [unique('event_discord_integrations_event_id_key').on(table.eventId)]
);

export const eventFormFields = sqliteTable(
  'event_form_fields',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull().default(0),
    helpText: text('help_text').notNull().default(''),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique('event_form_fields_event_id_field_key_key').on(table.eventId, table.fieldKey),
    unique('event_form_fields_event_id_id_key').on(table.eventId, table.id),
    check('event_form_fields_required_check', sql`${table.required} in (0, 1)`),
    check('event_form_fields_field_key_check', sql`length(${table.fieldKey}) > 0`),
    check('event_form_fields_label_check', sql`length(${table.label}) > 0`),
    check(
      'event_form_fields_field_type_check',
      sql`${table.fieldType} in ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'consent')`
    ),
    index('event_form_fields_event_position_idx').on(table.eventId, table.position)
  ]
);

export const eventFormFieldOptions = sqliteTable(
  'event_form_field_options',
  {
    id: id(),
    fieldId: text('field_id')
      .notNull()
      .references(() => eventFormFields.id, { onDelete: 'cascade' }),
    optionKey: text('option_key').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
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

export const registrations = sqliteTable(
  'registrations',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    number: integer('number').notNull().default(0),
    status: text('status').notNull(),
    holdExpiresAt: integer('hold_expires_at', { mode: 'timestamp_ms' }),
    holdWarnedAt: integer('hold_warned_at', { mode: 'timestamp_ms' }),
    locale: text('locale', { enum: ['ja', 'en'] })
      .notNull()
      .default('en'),
    holdReleased: integer('hold_released', { mode: 'boolean' }).notNull().default(false),
    displayNameSnapshot: text('display_name_snapshot').notNull(),
    searchText: text('search_text').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex('registrations_event_number_key').on(table.eventId, table.number),
    check(
      'registrations_held_deadline_check',
      sql`${table.status} <> 'held' or ${table.holdExpiresAt} is not null`
    ),
    check('registrations_locale_check', sql`${table.locale} in ('ja', 'en')`),
    check('registrations_hold_released_check', sql`${table.holdReleased} in (0, 1)`),
    check('registrations_number_check', sql`${table.number} >= 0`),
    unique('registrations_event_id_id_key').on(table.eventId, table.id),
    uniqueIndex('registrations_one_active_per_user_event')
      .on(table.eventId, table.userId)
      .where(sql`${table.status} <> 'cancelled'`),
    index('registrations_event_status_idx').on(table.eventId, table.status),
    check(
      'registrations_status_check',
      sql`${table.status} in ('applied', 'held', 'confirmed', 'waitlisted', 'cancelled')`
    ),
    check(
      'registrations_display_name_snapshot_check',
      sql`length(${table.displayNameSnapshot}) > 0`
    )
  ]
);

export const registrationFormAnswers = sqliteTable(
  'registration_form_answers',
  {
    id: id(),
    eventId: text('event_id').notNull(),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    fieldId: text('field_id')
      .notNull()
      .references(() => eventFormFields.id),
    fieldKeySnapshot: text('field_key_snapshot').notNull(),
    fieldLabelSnapshot: text('field_label_snapshot').notNull(),
    fieldTypeSnapshot: text('field_type_snapshot').notNull(),
    valueText: text('value_text').notNull().default(''),
    valueBool: integer('value_bool', { mode: 'boolean' }),
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
    check('registration_form_answers_value_bool_check', sql`${table.valueBool} in (0, 1)`),
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

export const registrationFormAnswerOptions = sqliteTable(
  'registration_form_answer_options',
  {
    answerId: text('answer_id')
      .notNull()
      .references(() => registrationFormAnswers.id, { onDelete: 'cascade' }),
    fieldId: text('field_id').notNull(),
    optionId: text('option_id')
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

export const stripeConnectAccounts = sqliteTable(
  'stripe_connect_accounts',
  {
    id: id(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stripeAccountId: text('stripe_account_id').notNull(),
    dashboardType: text('dashboard_type').notNull(),
    chargesEnabled: integer('charges_enabled', { mode: 'boolean' }).notNull().default(false),
    payoutsEnabled: integer('payouts_enabled', { mode: 'boolean' }).notNull().default(false),
    detailsSubmitted: integer('details_submitted', { mode: 'boolean' }).notNull().default(false),
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
    check('stripe_connect_accounts_charges_enabled_check', sql`${table.chargesEnabled} in (0, 1)`),
    check('stripe_connect_accounts_payouts_enabled_check', sql`${table.payoutsEnabled} in (0, 1)`),
    check(
      'stripe_connect_accounts_details_submitted_check',
      sql`${table.detailsSubmitted} in (0, 1)`
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

export const collections = sqliteTable(
  'collections',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    amountMinor: money('amount_minor'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
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

export const collectionPaymentMethods = sqliteTable(
  'collection_payment_methods',
  {
    id: id(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
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
    check('collection_payment_methods_enabled_check', sql`${table.enabled} in (0, 1)`),
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

export const paymentRequests = sqliteTable(
  'payment_requests',
  {
    id: id(),
    eventId: text('event_id').notNull(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id),
    collectionPaymentMethodId: text('collection_payment_method_id')
      .notNull()
      .references(() => collectionPaymentMethods.id),
    amountMinor: money('amount_minor'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
    remindedAt: integer('reminded_at', { mode: 'timestamp_ms' }),
    stripeAccountId: text('stripe_account_id').notNull().default(''),
    applicationFeeAmount: money('application_fee_amount').default(sql`0`),
    checkoutAttempt: integer('checkout_attempt').notNull().default(0),
    checkoutExpiresAt: integer('checkout_expires_at', { mode: 'timestamp_ms' }),
    checkoutUrl: text('checkout_url').notNull().default(''),
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
    check(
      'payment_requests_fee_check',
      sql`${table.applicationFeeAmount} >= 0 and ${table.applicationFeeAmount} <= ${table.amountMinor}`
    ),
    check('payment_requests_attempt_check', sql`${table.checkoutAttempt} >= 0`),
    check('payment_requests_amount_minor_check', sql`${table.amountMinor} >= 0`),
    check('payment_requests_currency_check', sql`length(${table.currency}) = 3`),
    check(
      'payment_requests_status_check',
      sql`${table.status} in ('pending', 'payment_pending', 'paid', 'waived', 'cancelled', 'refund_due')`
    ),
    check('payment_requests_charge_type_check', sql`${table.chargeType} in ('', 'direct')`),
    index('payment_requests_registration_idx').on(table.registrationId),
    index('payment_requests_collection_status_idx').on(table.collectionId, table.status),
    index('payment_requests_event_status_idx').on(table.eventId, table.status)
  ]
);

export const paymentRecords = sqliteTable(
  'payment_records',
  {
    id: id(),
    paymentRequestId: text('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id),
    collectionId: text('collection_id').notNull(),
    collectionPaymentMethodId: text('collection_payment_method_id')
      .notNull()
      .references(() => collectionPaymentMethods.id),
    externalReference: text('external_reference').notNull().default(''),
    note: text('note').notNull().default(''),
    applicationFeeAmount: money('application_fee_amount').default(sql`0`),
    amountMinor: money('amount_minor'),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    confirmedByUserId: text('confirmed_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    rawPayloadJson: text('raw_payload_json', { mode: 'json' }).$type<unknown>(),
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
    check('payment_records_raw_payload_json_check', sql`json_valid(${table.rawPayloadJson})`),
    check(
      'payment_records_fee_check',
      sql`${table.applicationFeeAmount} >= 0 and ${table.applicationFeeAmount} <= ${table.amountMinor}`
    ),
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

export const stripeWebhookEvents = sqliteTable(
  'stripe_webhook_events',
  {
    id: id(),
    stripeEventId: text('stripe_event_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull().default(''),
    eventType: text('event_type').notNull(),
    payloadJson: text('payload_json', { mode: 'json' }).$type<unknown>().notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt()
  },
  (table) => [
    unique('stripe_webhook_events_stripe_event_id_key').on(table.stripeEventId),
    check('stripe_webhook_events_payload_json_check', sql`json_valid(${table.payloadJson})`),
    check('stripe_webhook_events_stripe_event_id_check', sql`length(${table.stripeEventId}) > 0`),
    check('stripe_webhook_events_event_type_check', sql`length(${table.eventType}) > 0`)
  ]
);

export const checkinRecords = sqliteTable(
  'checkin_records',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
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
    index('checkin_records_event_idx').on(table.eventId, desc(table.createdAt)),
    index('checkin_records_registration_idx').on(table.registrationId)
  ]
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    beforeJson: text('before_json', { mode: 'json' }).$type<unknown>(),
    afterJson: text('after_json', { mode: 'json' }).$type<unknown>(),
    reason: text('reason').notNull().default(''),
    metadataJson: text('metadata_json', { mode: 'json' }).$type<unknown>(),
    createdAt: createdAt()
  },
  (table) => [
    check('audit_logs_before_json_check', sql`json_valid(${table.beforeJson})`),
    check('audit_logs_after_json_check', sql`json_valid(${table.afterJson})`),
    check('audit_logs_metadata_json_check', sql`json_valid(${table.metadataJson})`),
    check('audit_logs_action_check', sql`length(${table.action}) > 0`),
    check('audit_logs_target_type_check', sql`length(${table.targetType}) > 0`),
    index('audit_logs_event_created_idx').on(table.eventId, desc(table.createdAt)),
    index('audit_logs_target_idx').on(table.targetType, table.targetId)
  ]
);

export const outboxEvents = sqliteTable(
  'outbox_events',
  {
    id: id(),
    type: text('type').notNull(),
    dedupeKey: text('dedupe_key'),
    payloadJson: text('payload_json', { mode: 'json' }).$type<unknown>().notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error').notNull().default(''),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('outbox_events_pending_dedupe_key')
      .on(table.dedupeKey)
      .where(sql`${table.status} = 'pending' and ${table.dedupeKey} is not null`),
    check('outbox_events_payload_json_check', sql`json_valid(${table.payloadJson})`),
    check(
      'outbox_events_type_check',
      sql`${table.type} in ('discord.role_sync_requested', 'panel.refresh', 'notify')`
    ),
    check(
      'outbox_events_status_check',
      sql`${table.status} in ('pending', 'processing', 'processed', 'failed')`
    ),
    check('outbox_events_attempts_check', sql`${table.attempts} >= 0`),
    index('outbox_events_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    index('outbox_events_claimable_idx')
      .on(table.type, table.createdAt)
      .where(sql`${table.status} = 'pending'`)
  ]
);

export const discordPanels = sqliteTable(
  'discord_panels',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    locale: text('locale', { enum: ['ja', 'en'] }).notNull(),
    createdAt: createdAt(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    check('discord_panels_locale_check', sql`${table.locale} in ('ja', 'en')`),
    uniqueIndex('discord_panels_message_key').on(table.channelId, table.messageId),
    uniqueIndex('discord_panels_active_locale_key')
      .on(table.eventId, table.locale)
      .where(sql`${table.deletedAt} is null`),
    index('discord_panels_event_idx').on(table.eventId)
  ]
);

export const interactionDrafts = sqliteTable(
  'interaction_drafts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['join', 'edit'] }).notNull(),
    payloadJson: text('payload_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('interaction_drafts_actor_event_kind_key').on(
      table.userId,
      table.eventId,
      table.kind
    ),
    check('interaction_drafts_kind_check', sql`${table.kind} in ('join', 'edit')`),
    check('interaction_drafts_payload_check', sql`json_valid(${table.payloadJson})`),
    index('interaction_drafts_expiry_idx').on(table.expiresAt)
  ]
);

export const discordLayoutResources = sqliteTable(
  'discord_layout_resources',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull(),
    kind: text('kind').notNull(),
    discordId: text('discord_id').notNull(),
    creationName: text('creation_name').notNull(),
    createdAt: createdAt(),
    retiredAt: integer('retired_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    uniqueIndex('discord_layout_resources_active_kind_key')
      .on(table.eventId, table.guildId, table.kind)
      .where(sql`${table.retiredAt} is null`)
  ]
);

export const paymentCheckoutSessions = sqliteTable('payment_checkout_sessions', {
  sessionId: text('session_id').primaryKey(),
  paymentRequestId: text('payment_request_id')
    .notNull()
    .references(() => paymentRequests.id),
  attempt: integer('attempt').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  url: text('url').notNull()
});

export const notificationDeliveries = sqliteTable('notification_deliveries', {
  id: id(),
  registrationId: text('registration_id')
    .notNull()
    .references(() => registrations.id),
  kind: text('kind').notNull(),
  campaignId: text('campaign_id').notNull().default(''),
  channel: text('channel').notNull(),
  messageId: text('message_id').notNull().default(''),
  result: text('result').notNull(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull()
});
export const notificationThreads = sqliteTable('notification_threads', {
  registrationId: text('registration_id')
    .primaryKey()
    .references(() => registrations.id),
  threadId: text('thread_id').notNull().default(''),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' })
});
