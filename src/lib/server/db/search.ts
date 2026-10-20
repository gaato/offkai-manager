import type Database from 'better-sqlite3';
import { sql, type SQLWrapper } from 'drizzle-orm';

export const ilike = (value: SQLWrapper, pattern: string) =>
  sql`offkai_lower(${value}) LIKE offkai_lower(${pattern}) ESCAPE '\\'`;

export const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

export function registerSearchFunctions(connection: Database.Database): void {
  // Lower both LIKE operands here because SQLite's built-in lower only folds ASCII.
  connection.function('offkai_lower', { deterministic: true }, (value: unknown) =>
    value == null ? null : String(value).toLowerCase()
  );
}
