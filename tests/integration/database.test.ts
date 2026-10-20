import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  closeDatabase,
  openDatabase,
  pingDatabase,
  read,
  write,
  type DatabaseClient
} from '$lib/server/db/client';
import { escapeLikePattern, ilike } from '$lib/server/db/search';
import { runMigrations } from '$lib/server/db/migrate';
import { collections, organizations, users } from '$lib/server/db/schema';
import { testDatabase, fixedClock } from '../database';

// This function is type-checked, never executed: no invalid async callback reaches SQLite.
function transactionTypes(client: DatabaseClient, flag: boolean) {
  expectTypeOf(write(client, () => 42)).toEqualTypeOf<number>();
  expectTypeOf(read(client, () => 'snapshot')).toEqualTypeOf<string>();
  // @ts-expect-error An async callback commits at its first await.
  write(client, async () => 42);
  // @ts-expect-error Deferred reads must also remain synchronous.
  read(client, async () => 42);
  // @ts-expect-error PromiseLike callbacks are equally unsafe.
  write(client, () => ({ then: Promise.resolve(42).then.bind(Promise.resolve(42)) }));
  // @ts-expect-error A union containing a Promise must not escape the guard.
  write(client, (): number | Promise<number> => (flag ? 1 : Promise.resolve(1)));
}

void transactionTypes;

describe('SQLite foundation', () => {
  it('migrates and answers a readiness ping', async () => {
    const client = testDatabase();
    try {
      expect(runMigrations(client)).toBeUndefined();
      await expect(pingDatabase(client)).resolves.toBeUndefined();
      expect(
        read(client, (tx) =>
          tx.get<{
            answer: number;
          }>(sql`select 42 as answer`)
        )?.answer
      ).toBe(42);
    } finally {
      await closeDatabase(client);
    }
  });

  it('rolls back mutations together when the callback fails', () => {
    const client = testDatabase();
    try {
      expect(() =>
        write(client, (tx) => {
          tx.insert(users)
            .values({ createdAt: fixedClock.now(), updatedAt: fixedClock.now() })
            .run();
          throw new Error('rollback');
        })
      ).toThrow('rollback');
      expect(read(client, (tx) => tx.select().from(users).all())).toHaveLength(0);
    } finally {
      client.db.$client.close();
    }
  });

  it('preserves case-insensitive Unicode searches and SQL wildcard/escape semantics', () => {
    const client = testDatabase();
    try {
      for (const [value, pattern, expected] of [
        ['ÄLPhA東京', '%älpha%', 1],
        ['A_B', 'a\\_b', 1],
        ['A%B', 'a\\%b', 1],
        ['A東京B', 'a_b', 0],
        ['A😀B', 'a_b', 1],
        ['A\nB', 'a%b', 1],
        ['A', '%b%', 0]
      ] as const) {
        expect(
          read(client, (tx) =>
            tx.get<{ value: number }>(sql`select ${ilike(sql`${value}`, pattern)} as value`)
          )?.value
        ).toBe(expected);
      }
      for (const query of ['%', '_', '\\', 'Ä東京']) {
        const pattern = `%${escapeLikePattern(query)}%`;
        for (const [value, expected] of [
          [`before${query.toLowerCase()}after`, 1],
          ['other', 0]
        ] as const) {
          expect(
            read(client, (tx) =>
              tx.get<{ value: number }>(sql`select ${ilike(sql`${value}`, pattern)} as value`)
            )?.value
          ).toBe(expected);
        }
      }
      expect(
        read(client, (tx) =>
          tx.get<{ value: number }>(
            sql`select instr(offkai_lower('ÄLPhA'), offkai_lower('älpha')) as value`
          )
        )?.value
      ).toBe(1);
    } finally {
      client.db.$client.close();
    }
  });

  it('round-trips safe INTEGER money and rejects amounts outside the safe range', () => {
    const client = testDatabase();
    try {
      write(client, (tx) => {
        const org = tx
          .insert(organizations)
          .values({
            createdAt: fixedClock.now(),
            updatedAt: fixedClock.now(),
            name: 'Money',
            slug: 'money'
          })
          .returning()
          .get()!;
        const eventId = crypto.randomUUID();
        // Baseline defaults and app UUIDs both work, including raw SQL fixtures.
        tx.run(
          sql`insert into events (id, organization_id, title, slug, starts_at, ends_at, visibility, discord_policy, registration_opens_at, registration_closes_at) values (${eventId}, ${org.id}, 'Money', 'money', 1, 2, 'draft', 'not_used', 0, 1)`
        );
        for (const amountMinor of [0n, 5000n, BigInt(Number.MAX_SAFE_INTEGER)]) {
          const row = tx
            .insert(collections)
            .values({
              createdAt: fixedClock.now(),
              updatedAt: fixedClock.now(),
              eventId,
              title: 'Money',
              amountMinor,
              currency: 'JPY',
              status: 'draft'
            })
            .returning()
            .get()!;
          expect(row.amountMinor).toBe(amountMinor);
          expect(
            tx
              .select()
              .from(collections)
              .where(sql`${collections.id} = ${row.id}`)
              .get()?.amountMinor
          ).toBe(amountMinor);
        }
        for (const amountMinor of [
          BigInt(Number.MIN_SAFE_INTEGER) - 1n,
          BigInt(Number.MAX_SAFE_INTEGER) + 1n
        ]) {
          expect(() =>
            tx
              .insert(collections)
              .values({
                createdAt: fixedClock.now(),
                updatedAt: fixedClock.now(),
                eventId,
                title: 'Out of range',
                amountMinor,
                currency: 'JPY',
                status: 'draft'
              })
              .run()
          ).toThrow(RangeError);
        }
        expect(tx.select().from(collections).all()).toHaveLength(3);
      });
    } finally {
      client.db.$client.close();
    }
  });
  it('migrates a file-backed WAL database, enforces FKs and excludes another writer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'offkai-db-'));
    const path = join(directory, 'app.sqlite');
    const client = openDatabase(path);
    const other = openDatabase(path);
    try {
      runMigrations(client);
      expect(client.db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(client.db.$client.pragma('synchronous', { simple: true })).toBe(1);
      expect(client.db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(client.db.$client.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(() =>
        write(client, (tx) =>
          tx
            .insert(collections)
            .values({
              createdAt: fixedClock.now(),
              updatedAt: fixedClock.now(),
              eventId: crypto.randomUUID(),
              title: 'Orphan',
              amountMinor: 1n,
              currency: 'JPY',
              status: 'draft'
            })
            .run()
        )
      ).toThrow(/FOREIGN KEY/);
      other.db.$client.pragma('busy_timeout = 0');
      write(client, () => {
        expect(() => write(other, () => undefined)).toThrow(/locked/);
      });
      read(client, () => {
        expect(write(other, () => 42)).toBe(42);
      });
    } finally {
      await closeDatabase(other);
      await closeDatabase(client);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
