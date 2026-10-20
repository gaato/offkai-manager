import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import {
  closeDatabase,
  createDatabaseClient,
  pingDatabase,
  type DatabaseClient
} from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';

describe('PostgreSQL foundation', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const config = loadConfig({
      OFFKAI_DATABASE_URL: container.getConnectionUri(),
      OFFKAI_SESSION_SECRET: 'integration-test-session-secret',
      OFFKAI_AUTH_DEV_BYPASS: 'true'
    });
    client = createDatabaseClient(config);
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  it('applies an empty migration set and answers a readiness ping', async () => {
    await expect(runMigrations(client)).resolves.toBeUndefined();
    await expect(pingDatabase(client)).resolves.toBeUndefined();
    const result = await client.sql<{ answer: number }[]>`select 42::int as answer`;
    expect(result[0].answer).toBe(42);
  });
});
