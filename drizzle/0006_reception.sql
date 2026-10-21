ALTER TABLE organizations ADD COLUMN disclosure_json TEXT;
--> statement-breakpoint
ALTER TABLE event_discord_integrations ADD COLUMN scheduled_enabled INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE event_discord_integrations ADD COLUMN scheduled_state_json TEXT;
--> statement-breakpoint
ALTER TABLE notification_deliveries ADD COLUMN campaign_id TEXT NOT NULL DEFAULT '';
