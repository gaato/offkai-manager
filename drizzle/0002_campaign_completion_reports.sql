ALTER TABLE "campaigns" ADD COLUMN "completion_report_text" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "completion_reported_at" timestamp with time zone;
