import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { openDatabase, closeDatabase } from '$lib/server/db/client';
import {
  auditLogs,
  events,
  eventDiscordIntegrations,
  eventFormFields
} from '$lib/server/db/schema';
import { seedE2E } from '../../e2e/seed';
import { discordSetupFixture } from '../../e2e/fixtures';

it('seeds all e2e fixtures with enforced foreign keys and stable event/audit references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offkai-seed-test-'));
  try {
    const path = join(directory, 'offkai.sqlite');
    await seedE2E(path);
    const client = openDatabase(path);
    try {
      expect(client.db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(client.db.$client.pragma('foreign_key_check')).toEqual([]);
      const source = client.db
        .select()
        .from(events)
        .where(eq(events.id, discordSetupFixture.eventId))
        .get();
      expect(source).toMatchObject({
        title: discordSetupFixture.title,
        venueName: 'Copied Hall',
        capacity: 25,
        panelTemplateEn: 'Copied panel {title}'
      });
      const audits = client.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.eventId, discordSetupFixture.eventId),
            eq(auditLogs.action, 'event.create')
          )
        )
        .all();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        targetType: 'event',
        targetId: discordSetupFixture.eventId
      });
      expect(
        client.db
          .select()
          .from(eventDiscordIntegrations)
          .where(eq(eventDiscordIntegrations.eventId, discordSetupFixture.eventId))
          .get()?.guildId
      ).toBe(discordSetupFixture.guildId);
      expect(
        client.db
          .select()
          .from(eventFormFields)
          .where(eq(eventFormFields.eventId, discordSetupFixture.eventId))
          .all()
      ).toHaveLength(1);
      // Retain the constraint that exposed the bad seed; parent IDs must not be rewritten after auditing.
      expect(() =>
        client.db
          .update(events)
          .set({ id: 'ee000000-0000-4000-8000-000000000099' })
          .where(eq(events.id, discordSetupFixture.eventId))
          .run()
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      await closeDatabase(client);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
