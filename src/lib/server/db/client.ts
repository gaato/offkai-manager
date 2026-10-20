import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import type { Config } from '$lib/server/config';

export interface DatabaseClient {
  db: PostgresJsDatabase;
  sql: Sql;
}

export type DatabaseTransaction = Parameters<Parameters<DatabaseClient['db']['transaction']>[0]>[0];

let singleton: DatabaseClient | undefined;

export function createDatabaseClient(config: Config): DatabaseClient {
  if (!config.database.url) throw new Error('OFFKAI_DATABASE_URL is not configured');
  const sql = postgres(config.database.url, {
    max: config.database.maxOpenConnections,
    idle_timeout: Math.max(1, Math.floor(config.database.connectionMaxLifetimeMs / 1_000)),
    max_lifetime: Math.max(1, Math.floor(config.database.connectionMaxLifetimeMs / 1_000))
  });
  return { sql, db: drizzle(sql) };
}

export function getDatabaseClient(config: Config): DatabaseClient {
  singleton ??= createDatabaseClient(config);
  return singleton;
}

export async function pingDatabase(client: DatabaseClient): Promise<void> {
  await client.sql`select 1`;
}

export async function closeDatabase(client: DatabaseClient): Promise<void> {
  await client.sql.end();
  if (singleton === client) singleton = undefined;
}
