import { openDatabase } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import type { Clock } from '$lib/server/clock';

const epoch = new Date('2026-10-21T00:00:00.000Z').getTime();

let instant = epoch;

export const fixedClock: Clock & { advance(ms?: number): void } = {
  now: () => new Date(instant),
  advance: (ms = 1) => {
    instant += ms;
  }
};

let template: Buffer | undefined;

export function testDatabase() {
  instant = epoch;
  if (!template) {
    const client = openDatabase(':memory:');
    try {
      runMigrations(client);
      template = client.db.$client.serialize();
    } finally {
      client.db.$client.close();
    }
  }
  return openDatabase(template);
}
