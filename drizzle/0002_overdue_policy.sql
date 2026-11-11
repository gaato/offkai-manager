-- Hand-written: drizzle-kit rebuilds `events` for the CHECK and would drop STRICT and other
-- manual SQLite details. SQLite accepts a named CHECK on an added column instead.
ALTER TABLE `events` ADD `overdue_release` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `overdue_grace_days` integer DEFAULT 0 NOT NULL CONSTRAINT "events_overdue_policy_check" CHECK(`overdue_release` in ('auto', 'manual') and `overdue_grace_days` between 0 and 30);--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `overdue_notified_at` integer;
