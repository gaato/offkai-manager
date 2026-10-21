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
  // SQLite table rebuilds must preserve child rows while expanding CHECK constraints.
  // Disable FK actions before Drizzle begins its transaction, then validate and restore.
  client.db.$client.pragma('foreign_keys = OFF');
  try {
    migrate(client.db, { migrationsFolder });
    const violations = client.db.$client.pragma('foreign_key_check');
    if (Array.isArray(violations) && violations.length)
      throw new Error('migration foreign key violation');
  } finally {
    client.db.$client.pragma('foreign_keys = ON');
  }
}
