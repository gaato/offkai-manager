CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"goal_minor" bigint NOT NULL,
	"max_units_per_pledge" integer DEFAULT 10 NOT NULL,
	"fulfillment_date" date,
	"fulfillment_note" text DEFAULT '' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_organization_id_slug_key" UNIQUE("organization_id", "slug"),
	CONSTRAINT "campaigns_id_currency_key" UNIQUE("id", "currency"),
	CONSTRAINT "campaigns_title_check" CHECK (length("title") > 0),
	CONSTRAINT "campaigns_slug_check" CHECK (length("slug") > 0),
	CONSTRAINT "campaigns_unit_price_minor_check" CHECK ("unit_price_minor" > 0),
	CONSTRAINT "campaigns_goal_minor_check" CHECK ("goal_minor" >= 0),
	CONSTRAINT "campaigns_max_units_per_pledge_check" CHECK ("max_units_per_pledge" >= 1),
	CONSTRAINT "campaigns_currency_check" CHECK (length("currency") = 3),
	CONSTRAINT "campaigns_status_check" CHECK ("status" IN ('draft', 'open', 'closed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"list_publicly" boolean DEFAULT false NOT NULL,
	"unit_count" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"paid_at" timestamp with time zone,
	"access_token" text NOT NULL,
	"stripe_account_id" text DEFAULT '' NOT NULL,
	"checkout_session_id" text DEFAULT '' NOT NULL,
	"payment_intent_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_access_token_key" UNIQUE("access_token"),
	CONSTRAINT "orders_display_name_check" CHECK (length("display_name") > 0),
	CONSTRAINT "orders_unit_count_check" CHECK ("unit_count" >= 1),
	CONSTRAINT "orders_unit_price_minor_check" CHECK ("unit_price_minor" > 0),
	CONSTRAINT "orders_amount_minor_check" CHECK ("amount_minor" = "unit_price_minor" * "unit_count"),
	CONSTRAINT "orders_currency_check" CHECK (length("currency") = 3),
	CONSTRAINT "orders_status_check" CHECK ("status" IN ('pending', 'payment_pending', 'paid', 'expired', 'cancelled')),
	CONSTRAINT "orders_access_token_check" CHECK (length("access_token") >= 32),
	CONSTRAINT "orders_payment_pending_session_check" CHECK ("status" <> 'payment_pending' OR "checkout_session_id" <> '')
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_currency_fkey" FOREIGN KEY ("campaign_id", "currency") REFERENCES "public"."campaigns"("id", "currency") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "campaigns_organization_idx" ON "campaigns" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_session_id_key" ON "orders" USING btree ("checkout_session_id") WHERE "checkout_session_id" <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_payment_intent_id_key" ON "orders" USING btree ("payment_intent_id") WHERE "payment_intent_id" <> '';
--> statement-breakpoint
CREATE INDEX "orders_campaign_status_idx" ON "orders" USING btree ("campaign_id", "status");
