ALTER TABLE events ADD COLUMN panel_template_ja TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE events ADD COLUMN panel_template_en TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE events ADD COLUMN panel_template_reviewed_at INTEGER;
--> statement-breakpoint
ALTER TABLE event_discord_integrations ADD COLUMN paid_role_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE event_discord_integrations ADD COLUMN questions_channel_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE event_discord_integrations ADD COLUMN layout_claim TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE event_discord_integrations ADD COLUMN layout_claimed_at INTEGER;
--> statement-breakpoint
CREATE TABLE discord_layout_resources (
 id TEXT PRIMARY KEY NOT NULL,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 guild_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 discord_id TEXT NOT NULL,
 creation_name TEXT NOT NULL,
 created_at INTEGER DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
 retired_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX discord_layout_resources_active_kind_key ON discord_layout_resources(event_id, guild_id, kind) WHERE retired_at IS NULL;
