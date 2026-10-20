import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { DatabaseClient } from '$lib/server/db/client';

export async function runMigrations(
  client: DatabaseClient,
  migrationsFolder = resolve('drizzle')
): Promise<void> {
  const entries = await readdir(migrationsFolder, { withFileTypes: true });
  if (!entries.some((entry) => entry.isFile() && entry.name.endsWith('.sql'))) return;
  await migrate(client.db, { migrationsFolder });
}
