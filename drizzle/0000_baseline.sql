CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"event_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"before_json" jsonb,
	"after_json" jsonb,
	"reason" text DEFAULT '' NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_action_check" CHECK (length("audit_logs"."action") > 0),
	CONSTRAINT "audit_logs_target_type_check" CHECK (length("audit_logs"."target_type") > 0)
);
--> statement-breakpoint
CREATE TABLE "checkin_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"client_metadata" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_records_status_check" CHECK ("checkin_records"."status" in ('checked_in', 'manual_review')),
	CONSTRAINT "checkin_records_method_check" CHECK ("checkin_records"."method" in ('manual', 'search', 'qr'))
);
--> statement-breakpoint
CREATE TABLE "collection_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"timing" text DEFAULT 'onsite' NOT NULL,
	"confirmation" text DEFAULT 'manual' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	CONSTRAINT "collection_payment_methods_collection_id_label_key" UNIQUE("collection_id","label"),
	CONSTRAINT "collection_payment_methods_collection_id_id_key" UNIQUE("collection_id","id"),
	CONSTRAINT "collection_payment_methods_label_check" CHECK (length("collection_payment_methods"."label") > 0),
	CONSTRAINT "collection_payment_methods_timing_check" CHECK ("collection_payment_methods"."timing" in ('advance', 'onsite', 'none')),
	CONSTRAINT "collection_payment_methods_confirmation_check" CHECK ("collection_payment_methods"."confirmation" in ('internal', 'manual', 'none'))
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"due_at" timestamp with time zone,
	"instructions" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_event_id_id_key" UNIQUE("event_id","id"),
	CONSTRAINT "collections_id_currency_key" UNIQUE("id","currency"),
	CONSTRAINT "collections_title_check" CHECK (length("collections"."title") > 0),
	CONSTRAINT "collections_amount_minor_check" CHECK ("collections"."amount_minor" >= 0),
	CONSTRAINT "collections_currency_check" CHECK (length("collections"."currency") = 3),
	CONSTRAINT "collections_status_check" CHECK ("collections"."status" in ('draft', 'open', 'closed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "event_discord_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"guild_id" text DEFAULT '' NOT NULL,
	"guild_name_snapshot" text DEFAULT '' NOT NULL,
	"invite_url" text DEFAULT '' NOT NULL,
	"announcement_channel_id" text DEFAULT '' NOT NULL,
	"staff_channel_id" text DEFAULT '' NOT NULL,
	"role_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_discord_integrations_event_id_key" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "event_form_field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"option_key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_form_field_options_field_id_option_key_key" UNIQUE("field_id","option_key"),
	CONSTRAINT "event_form_field_options_field_id_id_key" UNIQUE("field_id","id"),
	CONSTRAINT "event_form_field_options_option_key_check" CHECK (length("event_form_field_options"."option_key") > 0),
	CONSTRAINT "event_form_field_options_label_check" CHECK (length("event_form_field_options"."label") > 0)
);
--> statement-breakpoint
CREATE TABLE "event_form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_form_fields_event_id_field_key_key" UNIQUE("event_id","field_key"),
	CONSTRAINT "event_form_fields_event_id_id_key" UNIQUE("event_id","id"),
	CONSTRAINT "event_form_fields_field_key_check" CHECK (length("event_form_fields"."field_key") > 0),
	CONSTRAINT "event_form_fields_label_check" CHECK (length("event_form_fields"."label") > 0),
	CONSTRAINT "event_form_fields_field_type_check" CHECK ("event_form_fields"."field_type" in ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'consent'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer,
	"visibility" text NOT NULL,
	"discord_policy" text NOT NULL,
	"registration_opens_at" timestamp with time zone NOT NULL,
	"registration_closes_at" timestamp with time zone NOT NULL,
	"venue_name" text DEFAULT '' NOT NULL,
	"venue_address" text DEFAULT '' NOT NULL,
	"venue_reveal" text DEFAULT 'public' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"cancellation_policy" text DEFAULT '' NOT NULL,
	"registration_mode" text DEFAULT 'auto_confirm' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_organization_id_slug_key" UNIQUE("organization_id","slug"),
	CONSTRAINT "events_title_check" CHECK (length("events"."title") > 0),
	CONSTRAINT "events_slug_check" CHECK (length("events"."slug") > 0),
	CONSTRAINT "events_ends_at_check" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_capacity_check" CHECK ("events"."capacity" >= 0),
	CONSTRAINT "events_visibility_check" CHECK ("events"."visibility" in ('draft', 'public', 'unlisted')),
	CONSTRAINT "events_discord_policy_check" CHECK ("events"."discord_policy" in ('not_used', 'optional', 'login_required', 'guild_join_required')),
	CONSTRAINT "events_venue_reveal_check" CHECK ("events"."venue_reveal" in ('public', 'confirmed')),
	CONSTRAINT "events_registration_mode_check" CHECK ("events"."registration_mode" in ('auto_confirm', 'approval'))
);
--> statement-breakpoint
CREATE TABLE "external_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_accounts_provider_provider_user_id_key" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "external_accounts_provider_check" CHECK ("external_accounts"."provider" in ('discord'))
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_id_user_id_key" UNIQUE("organization_id","user_id"),
	CONSTRAINT "organization_memberships_role_check" CHECK ("organization_memberships"."role" in ('owner', 'organizer', 'staff', 'viewer')),
	CONSTRAINT "organization_memberships_status_check" CHECK ("organization_memberships"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_key" UNIQUE("slug"),
	CONSTRAINT "organizations_name_check" CHECK (length("organizations"."name") > 0),
	CONSTRAINT "organizations_slug_check" CHECK (length("organizations"."slug") > 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"claimed_until" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_type_check" CHECK ("outbox_events"."type" in ('discord.role_sync_requested', 'notification.payment_requested', 'stripe.checkout_session_create_requested', 'payment.reconciliation_requested')),
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" in ('pending', 'processed', 'failed')),
	CONSTRAINT "outbox_events_attempts_check" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"collection_payment_method_id" uuid NOT NULL,
	"external_reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"raw_payload_json" jsonb,
	"idempotency_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_records_amount_minor_check" CHECK ("payment_records"."amount_minor" >= 0),
	CONSTRAINT "payment_records_currency_check" CHECK (length("payment_records"."currency") = 3),
	CONSTRAINT "payment_records_status_check" CHECK ("payment_records"."status" in ('pending', 'settled', 'failed', 'voided', 'refunded'))
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"collection_payment_method_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"due_at" timestamp with time zone,
	"stripe_account_id" text DEFAULT '' NOT NULL,
	"checkout_session_id" text DEFAULT '' NOT NULL,
	"payment_intent_id" text DEFAULT '' NOT NULL,
	"charge_type" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_collection_id_registration_id_key" UNIQUE("collection_id","registration_id"),
	CONSTRAINT "payment_requests_id_registration_id_key" UNIQUE("id","registration_id"),
	CONSTRAINT "payment_requests_id_collection_id_key" UNIQUE("id","collection_id"),
	CONSTRAINT "payment_requests_amount_minor_check" CHECK ("payment_requests"."amount_minor" >= 0),
	CONSTRAINT "payment_requests_currency_check" CHECK (length("payment_requests"."currency") = 3),
	CONSTRAINT "payment_requests_status_check" CHECK ("payment_requests"."status" in ('pending', 'pending_external_creation', 'payment_pending', 'paid', 'waived', 'cancelled')),
	CONSTRAINT "payment_requests_charge_type_check" CHECK ("payment_requests"."charge_type" in ('', 'direct'))
);
--> statement-breakpoint
CREATE TABLE "registration_form_answer_options" (
	"answer_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"option_key_snapshot" text NOT NULL,
	"option_label_snapshot" text NOT NULL,
	CONSTRAINT "registration_form_answer_options_pkey" PRIMARY KEY("answer_id","option_id"),
	CONSTRAINT "registration_form_answer_options_option_key_snapshot_check" CHECK (length("registration_form_answer_options"."option_key_snapshot") > 0),
	CONSTRAINT "registration_form_answer_options_option_label_snapshot_check" CHECK (length("registration_form_answer_options"."option_label_snapshot") > 0)
);
--> statement-breakpoint
CREATE TABLE "registration_form_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"field_key_snapshot" text NOT NULL,
	"field_label_snapshot" text NOT NULL,
	"field_type_snapshot" text NOT NULL,
	"value_text" text DEFAULT '' NOT NULL,
	"value_bool" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_form_answers_registration_id_field_id_key" UNIQUE("registration_id","field_id"),
	CONSTRAINT "registration_form_answers_id_field_id_key" UNIQUE("id","field_id"),
	CONSTRAINT "registration_form_answers_field_key_snapshot_check" CHECK (length("registration_form_answers"."field_key_snapshot") > 0),
	CONSTRAINT "registration_form_answers_field_label_snapshot_check" CHECK (length("registration_form_answers"."field_label_snapshot") > 0),
	CONSTRAINT "registration_form_answers_field_type_snapshot_check" CHECK ("registration_form_answers"."field_type_snapshot" in ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'consent'))
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"display_name_snapshot" text NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_event_id_id_key" UNIQUE("event_id","id"),
	CONSTRAINT "registrations_status_check" CHECK ("registrations"."status" in ('applied', 'confirmed', 'waitlisted', 'cancelled')),
	CONSTRAINT "registrations_display_name_snapshot_check" CHECK (length("registrations"."display_name_snapshot") > 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_connect_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"dashboard_type" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"onboarding_status" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"default_currency" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_connect_accounts_organization_id_key" UNIQUE("organization_id"),
	CONSTRAINT "stripe_connect_accounts_stripe_account_id_key" UNIQUE("stripe_account_id"),
	CONSTRAINT "stripe_connect_accounts_organization_id_stripe_account_id_key" UNIQUE("organization_id","stripe_account_id"),
	CONSTRAINT "stripe_connect_accounts_stripe_account_id_check" CHECK (length("stripe_connect_accounts"."stripe_account_id") > 0),
	CONSTRAINT "stripe_connect_accounts_dashboard_type_check" CHECK ("stripe_connect_accounts"."dashboard_type" in ('express', 'full', 'none')),
	CONSTRAINT "stripe_connect_accounts_onboarding_status_check" CHECK ("stripe_connect_accounts"."onboarding_status" in ('not_connected', 'onboarding_required', 'pending_verification', 'ready', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"stripe_account_id" text DEFAULT '' NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_webhook_events_stripe_event_id_key" UNIQUE("stripe_event_id"),
	CONSTRAINT "stripe_webhook_events_stripe_event_id_check" CHECK (length("stripe_webhook_events"."stripe_event_id") > 0),
	CONSTRAINT "stripe_webhook_events_event_type_check" CHECK (length("stripe_webhook_events"."event_type") > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_event_registration_fkey" FOREIGN KEY ("event_id","registration_id") REFERENCES "public"."registrations"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_payment_methods" ADD CONSTRAINT "collection_payment_methods_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_discord_integrations" ADD CONSTRAINT "event_discord_integrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_form_field_options" ADD CONSTRAINT "event_form_field_options_field_id_event_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."event_form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_form_fields" ADD CONSTRAINT "event_form_fields_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_collection_payment_method_id_collection_payment_methods_id_fk" FOREIGN KEY ("collection_payment_method_id") REFERENCES "public"."collection_payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_request_registration_fkey" FOREIGN KEY ("payment_request_id","registration_id") REFERENCES "public"."payment_requests"("id","registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_request_collection_fkey" FOREIGN KEY ("payment_request_id","collection_id") REFERENCES "public"."payment_requests"("id","collection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_collection_method_fkey" FOREIGN KEY ("collection_id","collection_payment_method_id") REFERENCES "public"."collection_payment_methods"("collection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_collection_payment_method_id_collection_payment_methods_id_fk" FOREIGN KEY ("collection_payment_method_id") REFERENCES "public"."collection_payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_event_collection_fkey" FOREIGN KEY ("event_id","collection_id") REFERENCES "public"."collections"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_event_registration_fkey" FOREIGN KEY ("event_id","registration_id") REFERENCES "public"."registrations"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_collection_method_fkey" FOREIGN KEY ("collection_id","collection_payment_method_id") REFERENCES "public"."collection_payment_methods"("collection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_collection_currency_fkey" FOREIGN KEY ("collection_id","currency") REFERENCES "public"."collections"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answer_options" ADD CONSTRAINT "registration_form_answer_options_answer_id_registration_form_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."registration_form_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answer_options" ADD CONSTRAINT "registration_form_answer_options_option_id_event_form_field_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."event_form_field_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answer_options" ADD CONSTRAINT "registration_form_answer_options_answer_field_fkey" FOREIGN KEY ("answer_id","field_id") REFERENCES "public"."registration_form_answers"("id","field_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answer_options" ADD CONSTRAINT "registration_form_answer_options_field_option_fkey" FOREIGN KEY ("field_id","option_id") REFERENCES "public"."event_form_field_options"("field_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answers" ADD CONSTRAINT "registration_form_answers_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answers" ADD CONSTRAINT "registration_form_answers_field_id_event_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."event_form_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answers" ADD CONSTRAINT "registration_form_answers_event_registration_fkey" FOREIGN KEY ("event_id","registration_id") REFERENCES "public"."registrations"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_form_answers" ADD CONSTRAINT "registration_form_answers_event_field_fkey" FOREIGN KEY ("event_id","field_id") REFERENCES "public"."event_form_fields"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" ADD CONSTRAINT "stripe_connect_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_event_created_idx" ON "audit_logs" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "checkin_records_event_idx" ON "checkin_records" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "checkin_records_registration_idx" ON "checkin_records" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "collections_event_idx" ON "collections" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_form_field_options_field_position_idx" ON "event_form_field_options" USING btree ("field_id","position");--> statement-breakpoint
CREATE INDEX "event_form_fields_event_position_idx" ON "event_form_fields" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "events_archived_at_idx" ON "events" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_organization_status_idx" ON "organization_memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organizations_suspended_at_idx" ON "organizations" USING btree ("suspended_at") WHERE "organizations"."suspended_at" is not null;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_claimable_idx" ON "outbox_events" USING btree ("type","created_at") WHERE "outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_records_idempotency_key_idx" ON "payment_records" USING btree ("idempotency_key") WHERE "payment_records"."idempotency_key" <> '';--> statement-breakpoint
CREATE INDEX "payment_records_request_idx" ON "payment_records" USING btree ("payment_request_id");--> statement-breakpoint
CREATE INDEX "payment_records_registration_idx" ON "payment_records" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "payment_records_collection_idx" ON "payment_records" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_checkout_session_id_key" ON "payment_requests" USING btree ("checkout_session_id") WHERE "payment_requests"."checkout_session_id" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_payment_intent_id_key" ON "payment_requests" USING btree ("payment_intent_id") WHERE "payment_requests"."payment_intent_id" <> '';--> statement-breakpoint
CREATE INDEX "payment_requests_registration_idx" ON "payment_requests" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "payment_requests_collection_status_idx" ON "payment_requests" USING btree ("collection_id","status");--> statement-breakpoint
CREATE INDEX "payment_requests_event_status_idx" ON "payment_requests" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "registration_form_answer_options_option_idx" ON "registration_form_answer_options" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "registration_form_answers_registration_idx" ON "registration_form_answers" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "registration_form_answers_field_idx" ON "registration_form_answers" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "registration_form_answers_event_idx" ON "registration_form_answers" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_one_active_per_user_event" ON "registrations" USING btree ("event_id","user_id") WHERE "registrations"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "registrations_event_status_idx" ON "registrations" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "registrations_event_search_idx" ON "registrations" USING gin (to_tsvector('simple', "search_text"));
