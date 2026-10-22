ALTER TABLE `events` ADD `payment_opens_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `payment_due_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `additional_opens_at` integer;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `reminded_at` integer;