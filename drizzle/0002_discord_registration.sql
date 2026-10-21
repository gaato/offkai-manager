ALTER TABLE event_discord_integrations ADD COLUMN staff_role_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE event_discord_integrations ADD COLUMN notification_channel_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE registrations ADD COLUMN number INTEGER NOT NULL DEFAULT 0 CONSTRAINT "registrations_number_check" CHECK(number >= 0);
--> statement-breakpoint
WITH numbered AS (SELECT id, row_number() OVER (PARTITION BY event_id ORDER BY created_at, id) AS n FROM registrations)
UPDATE registrations SET number = (SELECT n FROM numbered WHERE numbered.id = registrations.id);
--> statement-breakpoint
CREATE UNIQUE INDEX registrations_event_number_key ON registrations(event_id, number);
--> statement-breakpoint
-- Direct fixture/import inserts receive numbers too. Cancelled rows retain their number.
CREATE TRIGGER registrations_assign_number AFTER INSERT ON registrations WHEN NEW.number = 0
BEGIN
  UPDATE registrations SET number = (SELECT coalesce(max(number), 0) + 1 FROM registrations WHERE event_id = NEW.event_id) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TABLE discord_panels (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  locale TEXT NOT NULL CONSTRAINT "discord_panels_locale_check" CHECK(locale IN ('ja', 'en')),
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)),
  deleted_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX discord_panels_message_key ON discord_panels(channel_id, message_id);
--> statement-breakpoint
CREATE UNIQUE INDEX discord_panels_active_locale_key ON discord_panels(event_id, locale) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX discord_panels_event_idx ON discord_panels(event_id);
--> statement-breakpoint
CREATE TABLE interaction_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CONSTRAINT "interaction_drafts_kind_check" CHECK(kind IN ('join', 'edit')),
  payload_json TEXT NOT NULL CONSTRAINT "interaction_drafts_payload_check" CHECK(json_valid(payload_json)),
  expires_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX interaction_drafts_actor_event_kind_key ON interaction_drafts(user_id, event_id, kind);
--> statement-breakpoint
CREATE INDEX interaction_drafts_expiry_idx ON interaction_drafts(expires_at);
--> statement-breakpoint
CREATE TABLE outbox_events_new (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CONSTRAINT "outbox_events_type_check" CHECK(type IN ('discord.role_sync_requested', 'panel.refresh')),
  dedupe_key TEXT,
  payload_json TEXT NOT NULL CONSTRAINT "outbox_events_payload_json_check" CHECK(json_valid(payload_json)),
  status TEXT NOT NULL CONSTRAINT "outbox_events_status_check" CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CONSTRAINT "outbox_events_attempts_check" CHECK(attempts >= 0),
  last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at INTEGER,
  processed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer))
) STRICT;
--> statement-breakpoint
INSERT INTO outbox_events_new (id, type, payload_json, status, attempts, last_error, next_attempt_at, processed_at, created_at)
SELECT id, type, payload_json, status, attempts, last_error, next_attempt_at, processed_at, created_at FROM outbox_events;
--> statement-breakpoint
DROP TABLE outbox_events;
--> statement-breakpoint
ALTER TABLE outbox_events_new RENAME TO outbox_events;
--> statement-breakpoint
CREATE INDEX outbox_events_pending_idx ON outbox_events(created_at) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX outbox_events_claimable_idx ON outbox_events(type, created_at) WHERE status = 'pending';
--> statement-breakpoint
CREATE UNIQUE INDEX outbox_events_pending_dedupe_key ON outbox_events(dedupe_key) WHERE status = 'pending' AND dedupe_key IS NOT NULL;
