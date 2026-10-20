import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DatabaseClient } from '$lib/server/db/client';

export function runMigrations(client: DatabaseClient, migrationsFolder = resolve('drizzle')): void {
  // Drizzle's default ledger uses SERIAL/NUMERIC, which SQLite STRICT rejects.
  // Create its compatible INTEGER ledger first so every persisted table is strict.
  client.db.run(sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER
  ) STRICT`);
  migrate(client.db, { migrationsFolder });
}
