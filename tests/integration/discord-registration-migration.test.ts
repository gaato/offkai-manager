import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { eventDiscordIntegrations, outboxEvents, registrations } from '$lib/server/db/schema';

it('upgrades populated databases without losing registration history, roles, or pending outbox retries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'offkai-discord-migration-'));
  const client = openDatabase(':memory:');
  try {
    mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 2);
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    runMigrations(client, directory);
    client.db.$client.exec(`
      INSERT INTO users (id) VALUES ('user-a'), ('user-b');
      INSERT INTO organizations (id, name, slug) VALUES ('org', 'Organization', 'organization');
      INSERT INTO events (id, organization_id, title, slug, starts_at, ends_at, visibility, discord_policy, registration_opens_at, registration_closes_at)
      VALUES ('event-a', 'org', 'A', 'a', 100, 200, 'public', 'optional', 1, 90), ('event-b', 'org', 'B', 'b', 100, 200, 'public', 'optional', 1, 90);
      INSERT INTO registrations (id, event_id, user_id, status, display_name_snapshot, created_at)
      VALUES ('a', 'event-a', 'user-a', 'cancelled', 'A', 10), ('b', 'event-a', 'user-b', 'confirmed', 'B', 20), ('c', 'event-b', 'user-a', 'confirmed', 'A', 10);
      INSERT INTO event_discord_integrations (id, event_id, guild_id, staff_channel_id, role_id)
      VALUES ('integration', 'event-a', '400000000000000001', '500000000000000001', '600000000000000001');
      INSERT INTO outbox_events (id, type, payload_json, status, attempts, last_error, next_attempt_at)
      VALUES ('task', 'discord.role_sync_requested', '{"event_id":"event-a","registration_id":"b"}', 'pending', 3, 'Previously unavailable', 123456);
    `);
    runMigrations(client);
    expect(
      client.db
        .select()
        .from(registrations)
        .all()
        .map((row) => [row.id, row.number, row.status])
    ).toEqual([
      ['a', 1, 'cancelled'],
      ['b', 2, 'confirmed'],
      ['c', 1, 'confirmed']
    ]);
    expect(client.db.select().from(eventDiscordIntegrations).get()).toMatchObject({
      roleId: '600000000000000001',
      staffChannelId: '500000000000000001',
      staffRoleId: '',
      notificationChannelId: ''
    });
    expect(client.db.select().from(outboxEvents).get()).toMatchObject({
      status: 'pending',
      attempts: 3,
      lastError: 'Previously unavailable',
      nextAttemptAt: new Date(123456),
      payloadJson: { event_id: 'event-a', registration_id: 'b' }
    });
    client.db.$client.exec(
      "INSERT INTO registrations (id, event_id, user_id, status, display_name_snapshot) VALUES ('d', 'event-a', 'user-a', 'confirmed', 'A')"
    );
    expect(
      client.db
        .select()
        .from(registrations)
        .all()
        .find((row) => row.id === 'd')!.number
    ).toBe(3);
    expect(client.db.$client.pragma('foreign_key_check')).toEqual([]);
  } finally {
    client.db.$client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
