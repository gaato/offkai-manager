CREATE TABLE `registrations_new` (
`number` integer DEFAULT 0 NOT NULL CONSTRAINT "registrations_number_check" CHECK(number >= 0),
`hold_expires_at` integer,
`hold_warned_at` integer,
`hold_released` integer DEFAULT 0 NOT NULL CONSTRAINT "registrations_hold_released_check" CHECK(hold_released in (0, 1)),

	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`display_name_snapshot` text NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
CONSTRAINT "registrations_held_deadline_check" CHECK(status <> 'held' or hold_expires_at is not null),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registrations_status_check" CHECK("status" in ('applied', 'held', 'confirmed', 'waitlisted', 'cancelled')),
	CONSTRAINT "registrations_display_name_snapshot_check" CHECK(length("display_name_snapshot") > 0)
) STRICT;
--> statement-breakpoint
INSERT INTO registrations_new (`id`,
`event_id`,
`user_id`,
`status`,
`display_name_snapshot`,
`search_text`,
`created_at`,
`updated_at`,
`number`) SELECT `id`,
`event_id`,
`user_id`,
`status`,
`display_name_snapshot`,
`search_text`,
`created_at`,
`updated_at`,
`number` FROM registrations;
--> statement-breakpoint
DROP TABLE registrations;
--> statement-breakpoint
ALTER TABLE registrations_new RENAME TO registrations;
--> statement-breakpoint
CREATE UNIQUE INDEX `registrations_one_active_per_user_event` ON `registrations` (`event_id`,`user_id`) WHERE "status" <> 'cancelled';
--> statement-breakpoint
CREATE INDEX `registrations_event_status_idx` ON `registrations` (`event_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `registrations_event_id_id_key` ON `registrations` (`event_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX registrations_event_number_key ON registrations(event_id, number);
--> statement-breakpoint
CREATE TRIGGER registrations_assign_number AFTER INSERT ON registrations WHEN NEW.number = 0
BEGIN
  UPDATE registrations SET number = (SELECT coalesce(max(number), 0) + 1 FROM registrations WHERE event_id = NEW.event_id) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TABLE `payment_requests_new` (
`application_fee_amount` integer DEFAULT 0 NOT NULL CONSTRAINT "payment_requests_fee_check" CHECK(application_fee_amount >= 0 and application_fee_amount <= amount_minor),
`checkout_attempt` integer DEFAULT 0 NOT NULL CONSTRAINT "payment_requests_attempt_check" CHECK(checkout_attempt >= 0),
`checkout_expires_at` integer,
`checkout_url` text DEFAULT '' NOT NULL,

	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`collection_payment_method_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`due_at` integer,
	`stripe_account_id` text DEFAULT '' NOT NULL,
	`checkout_session_id` text DEFAULT '' NOT NULL,
	`payment_intent_id` text DEFAULT '' NOT NULL,
	`charge_type` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_payment_method_id`) REFERENCES `collection_payment_methods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`,`collection_id`) REFERENCES `collections`(`event_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`,`registration_id`) REFERENCES `registrations`(`event_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_id`,`collection_payment_method_id`) REFERENCES `collection_payment_methods`(`collection_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_id`,`currency`) REFERENCES `collections`(`id`,`currency`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_requests_amount_minor_check" CHECK("amount_minor" >= 0),
	CONSTRAINT "payment_requests_currency_check" CHECK(length("currency") = 3),
	CONSTRAINT "payment_requests_status_check" CHECK("status" in ('pending', 'payment_pending', 'paid', 'waived', 'cancelled', 'refund_due')),
	CONSTRAINT "payment_requests_charge_type_check" CHECK("charge_type" in ('', 'direct'))
) STRICT;
--> statement-breakpoint
INSERT INTO payment_requests_new (`id`,
`event_id`,
`collection_id`,
`registration_id`,
`collection_payment_method_id`,
`amount_minor`,
`currency`,
`status`,
`due_at`,
`stripe_account_id`,
`checkout_session_id`,
`payment_intent_id`,
`charge_type`,
`created_at`,
`updated_at`) SELECT `id`,
`event_id`,
`collection_id`,
`registration_id`,
`collection_payment_method_id`,
`amount_minor`,
`currency`,
`status`,
`due_at`,
`stripe_account_id`,
`checkout_session_id`,
`payment_intent_id`,
`charge_type`,
`created_at`,
`updated_at` FROM payment_requests;
--> statement-breakpoint
DROP TABLE payment_requests;
--> statement-breakpoint
ALTER TABLE payment_requests_new RENAME TO payment_requests;
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_checkout_session_id_key` ON `payment_requests` (`checkout_session_id`) WHERE "checkout_session_id" <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_payment_intent_id_key` ON `payment_requests` (`payment_intent_id`) WHERE "payment_intent_id" <> '';
--> statement-breakpoint
CREATE INDEX `payment_requests_registration_idx` ON `payment_requests` (`registration_id`);
--> statement-breakpoint
CREATE INDEX `payment_requests_collection_status_idx` ON `payment_requests` (`collection_id`,`status`);
--> statement-breakpoint
CREATE INDEX `payment_requests_event_status_idx` ON `payment_requests` (`event_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_collection_id_registration_id_key` ON `payment_requests` (`collection_id`,`registration_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_id_registration_id_key` ON `payment_requests` (`id`,`registration_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_id_collection_id_key` ON `payment_requests` (`id`,`collection_id`);
--> statement-breakpoint
CREATE TABLE `outbox_events_new` (
`dedupe_key` text,

	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`next_attempt_at` integer,
	`processed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "outbox_events_payload_json_check" CHECK(json_valid("payload_json")),
	CONSTRAINT "outbox_events_type_check" CHECK("type" in ('discord.role_sync_requested', 'panel.refresh', 'notify')),
	CONSTRAINT "outbox_events_status_check" CHECK("status" in ('pending', 'processing', 'processed', 'failed')),
	CONSTRAINT "outbox_events_attempts_check" CHECK("attempts" >= 0)
) STRICT;
--> statement-breakpoint
INSERT INTO outbox_events_new (`id`,
`type`,
`payload_json`,
`status`,
`attempts`,
`last_error`,
`next_attempt_at`,
`processed_at`,
`created_at`,
`dedupe_key`) SELECT `id`,
`type`,
`payload_json`,
`status`,
`attempts`,
`last_error`,
`next_attempt_at`,
`processed_at`,
`created_at`,
`dedupe_key` FROM outbox_events;
--> statement-breakpoint
DROP TABLE outbox_events;
--> statement-breakpoint
ALTER TABLE outbox_events_new RENAME TO outbox_events;
--> statement-breakpoint
CREATE INDEX `outbox_events_pending_idx` ON `outbox_events` (`created_at`) WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX `outbox_events_claimable_idx` ON `outbox_events` (`type`,`created_at`) WHERE "status" = 'pending';
--> statement-breakpoint
CREATE UNIQUE INDEX outbox_events_pending_dedupe_key ON outbox_events(dedupe_key) WHERE status = 'pending' AND dedupe_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN payment_requirement TEXT NOT NULL DEFAULT 'none' CONSTRAINT "events_payment_requirement_check" CHECK(payment_requirement IN ('none','pay_to_confirm','pay_later'));
--> statement-breakpoint
ALTER TABLE events ADD COLUMN platform_fee_bps INTEGER NOT NULL DEFAULT 0 CONSTRAINT "events_platform_fee_bps_check" CHECK(platform_fee_bps >= 0 AND platform_fee_bps < 10000);
--> statement-breakpoint
ALTER TABLE events ADD COLUMN amount_to_collect_minor INTEGER NOT NULL DEFAULT 0 CONSTRAINT "events_amount_to_collect_minor_check" CHECK(amount_to_collect_minor >= 0);
--> statement-breakpoint
ALTER TABLE events ADD COLUMN rounding_unit INTEGER NOT NULL DEFAULT 1 CONSTRAINT "events_rounding_unit_check" CHECK(rounding_unit > 0);
--> statement-breakpoint
ALTER TABLE events ADD COLUMN hold_minutes INTEGER NOT NULL DEFAULT 30 CONSTRAINT "events_hold_minutes_check" CHECK(hold_minutes >= 30 AND hold_minutes <= 1440);
--> statement-breakpoint
CREATE TABLE payment_checkout_sessions (session_id TEXT PRIMARY KEY NOT NULL, payment_request_id TEXT NOT NULL REFERENCES payment_requests(id), attempt INTEGER NOT NULL, expires_at INTEGER NOT NULL, url TEXT NOT NULL) STRICT;
--> statement-breakpoint
CREATE TABLE notification_deliveries (id TEXT PRIMARY KEY NOT NULL, registration_id TEXT NOT NULL REFERENCES registrations(id), kind TEXT NOT NULL, channel TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '', result TEXT NOT NULL, at INTEGER NOT NULL) STRICT;
--> statement-breakpoint
CREATE TABLE notification_threads (registration_id TEXT PRIMARY KEY NOT NULL REFERENCES registrations(id), thread_id TEXT NOT NULL DEFAULT '', archived_at INTEGER) STRICT;
--> statement-breakpoint
CREATE INDEX notification_deliveries_registration_idx ON notification_deliveries(registration_id, at);

--> statement-breakpoint
ALTER TABLE payment_records ADD COLUMN application_fee_amount INTEGER NOT NULL DEFAULT 0 CONSTRAINT "payment_records_fee_check" CHECK(application_fee_amount >= 0 and application_fee_amount <= amount_minor);

--> statement-breakpoint
-- Existing open priced collections already confirm attendance before collecting money.
-- Preserve their price and ledger while making that admission contract explicit.
UPDATE events SET payment_requirement = 'pay_later',
  amount_to_collect_minor = (SELECT amount_minor FROM collections WHERE collections.event_id = events.id AND collections.status = 'open' AND amount_minor > 0 ORDER BY created_at, id LIMIT 1)
WHERE EXISTS (SELECT 1 FROM collections WHERE collections.event_id = events.id AND collections.status = 'open' AND amount_minor > 0);
