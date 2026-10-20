import Database from 'better-sqlite3';
import { registerSearchFunctions } from './search';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Config } from '$lib/server/config';

export interface DatabaseClient {
  db: BetterSQLite3Database & { $client: Database.Database };
}

export type DatabaseTransaction = Parameters<Parameters<DatabaseClient['db']['transaction']>[0]>[0];

type Synchronous<T> = T extends PromiseLike<unknown> ? never : T;

export function write<T>(
  client: DatabaseClient,
  fn: (tx: DatabaseTransaction) => T & Synchronous<T>
): T {
  return client.db.transaction((tx) => rejectPromise(fn(tx)), { behavior: 'immediate' });
}

export function read<T>(
  client: DatabaseClient,
  fn: (tx: DatabaseTransaction) => T & Synchronous<T>
): T {
  return client.db.transaction((tx) => rejectPromise(fn(tx)), { behavior: 'deferred' });
}

function rejectPromise<T>(value: T): T {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  ) {
    throw new TypeError('Database transactions must be synchronous');
  }
  return value;
}

let singleton: DatabaseClient | undefined;

export function openDatabase(path: string | Buffer): DatabaseClient {
  const connection = new Database(path);
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  registerSearchFunctions(connection);
  return { db: drizzle(connection) };
}

export function createDatabaseClient(config: Config): DatabaseClient {
  if (!config.database.path) throw new Error('OFFKAI_DATABASE_PATH is not configured');
  return openDatabase(config.database.path);
}

export function getDatabaseClient(config: Config): DatabaseClient {
  singleton ??= createDatabaseClient(config);
  return singleton;
}

export async function pingDatabase(client: DatabaseClient): Promise<void> {
  client.db.$client.prepare('select 1').get();
}

export async function closeDatabase(client: DatabaseClient): Promise<void> {
  client.db.$client.close();
  if (singleton === client) singleton = undefined;
}
