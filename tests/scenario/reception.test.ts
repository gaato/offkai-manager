import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { APIInteraction } from 'discord-api-types/v10';
import { closeDatabase, getDatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { getConfig, defaultTuning, resetConfigForTests } from '$lib/server/config';
import {
  eventDiscordIntegrations,
  checkinRecords,
  paymentRecords,
  registrations,
  outboxEvents,
  notificationDeliveries
} from '$lib/server/db/schema';
import * as restModule from '$lib/server/interactions/rest';
import { systemClock } from '$lib/server/clock';
import { processRoleSyncBatch } from '$lib/server/worker/role-sync';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import { POST } from '../../src/routes/interactions/+server';
import { paidEvent } from '../support/paid-event';
import { discordEvent } from '../support/discord-registration';
import {
  signedRequest,
  makeChatInput,
  makeComponent,
  makeAutocomplete
} from '../support/interactions';
import { recordingRest } from '../support/discord-rest';
import { signingKey } from '../support/scenario-setup';
import { fixedClock } from '../database';
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
let transport: ReturnType<typeof recordingRest>;
let client: ReturnType<typeof getDatabaseClient>;
beforeEach(() => {
  vi.stubEnv('OFFKAI_DISCORD_BOT_TOKEN', 'fake-test-token');
  resetConfigForTests();
  transport = recordingRest();
  transport.rest.options.globalRequestsPerSecond = 10000;
  vi.spyOn(restModule, 'getInteractionRest').mockReturnValue(transport.rest);
  client = getDatabaseClient(getConfig());
  runMigrations(client);
  vi.spyOn(systemClock, 'now').mockImplementation(() => fixedClock.now());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase(client);
  vi.stubEnv('OFFKAI_DISCORD_BOT_TOKEN', undefined);
  resetConfigForTests();
});
async function call(interaction: APIInteraction) {
  const response = await POST({
    request: await signedRequest(interaction, signingKey.privateKey)
  } as Parameters<typeof POST>[0]);
  expect(response.status).toBe(200);
  return response.json();
}
function command(name: 'checkin' | 'status' | 'remind', eventId?: string, who?: string) {
  const i = makeChatInput(name === 'checkin' ? 'checkin' : 'offkai', name);
  const options = [
    ...(who ? [{ type: 3 as const, name: 'who', value: who }] : []),
    ...(eventId ? [{ type: 3 as const, name: 'event', value: eventId }] : [])
  ];
  i.data.options = name === 'checkin' ? options : [{ type: 1, name, options }];
  return i;
}
it('signed staff role check-in, autocomplete, receipt, repeat, undo and organizer status/reminder', async () => {
  const f = await paidEvent(client, 'pay_to_confirm', 180);
  const r = await f.join(undefined, 'ja');
  client.db
    .update(eventDiscordIntegrations)
    .set({ staffRoleId: '600000000000000001' })
    .where(eq(eventDiscordIntegrations.eventId, f.event.id))
    .run();
  const staff = <T extends APIInteraction>(i: T): T => {
    if ('member' in i && i.member)
      i.member.user = { ...i.member.user, id: '200000000000000099', username: 'door-staff' };
    return i;
  };
  const auto = await call(staff(makeAutocomplete(String(r.number).padStart(3, '0'))));
  expect(auto.data.choices).toHaveLength(1);
  expect(auto.data.choices[0].name).toContain('Unpaid');
  const card = JSON.stringify(await call(staff(command('checkin', undefined, r.id))));
  expect(card).toContain('Received');
  expect(card).toContain('door_cash');
  const outsider = staff(makeComponent(`om1:door_cash:${r.id}`));
  outsider.member!.roles = [];
  expect(JSON.stringify(await call(outsider))).toContain('Could not complete');
  expect(client.db.select().from(paymentRecords).all()).toHaveLength(0);
  for (const method of ['cash', 'cash', 'paypay', 'check'])
    await call(staff(makeComponent(`om1:door_${method}:${r.id}`)));
  expect(client.db.select().from(checkinRecords).all()).toHaveLength(1);
  expect(client.db.select().from(paymentRecords).all()).toHaveLength(1);
  expect(JSON.stringify(await call(staff(command('checkin', undefined, r.id))))).toContain(
    'Checked in by'
  );
  await call(staff(makeComponent(`om1:door_undo:${r.id}`)));
  expect(client.db.select().from(checkinRecords).all()).toHaveLength(0);
  await f.join('200000000000000003', 'en');
  const status = JSON.stringify(await call(command('status')));
  expect(status).toContain('Held: 1');
  expect(status).toContain('/legal/');
  expect(status).toContain('/app/events/');
  const preview = JSON.stringify(await call(command('remind')));
  expect(preview).toContain('your participation fee');
  expect(preview).toContain('参加費');
  const confirm = preview.match(/om1:remind_confirm:([a-f0-9-]+)/)![0];
  expect(JSON.stringify(await call(makeComponent(confirm)))).toContain('Queued 1 reminders');
  expect(JSON.stringify(await call(makeComponent(confirm)))).toContain('Queued 0 reminders');
  const transport = recordingRest();
  const gateway = createDiscordGateway('fake', {
    fetch: async () => new Response(null, { status: 204 })
  });
  for (let n = 0; n < 20; n++) {
    const count = await processRoleSyncBatch(
      client,
      gateway,
      undefined,
      fixedClock,
      defaultTuning,
      transport.rest
    );
    if (!count) fixedClock.advance(1000);
  }
  expect(
    client.db
      .select()
      .from(notificationDeliveries)
      .all()
      .some((d) => d.kind === 'payment_reminder' && Boolean(d.campaignId) && d.result === 'sent')
  ).toBe(true);
});
it('requires explicit event when multiple guild events are open and rechecks option IDs', async () => {
  const a = await paidEvent(client, 'none', 180);
  const r = await a.join();
  await discordEvent(client);
  expect(JSON.stringify(await call(command('checkin', undefined, r.id)))).toContain(
    'Choose an event'
  );
  expect(JSON.stringify(await call(command('checkin', a.event.id, r.id)))).toContain('door_check');
  const i = makeAutocomplete('');
  i.data.options = [{ type: 3, name: 'event', value: '', focused: true }];
  expect((await call(i)).data.choices).toHaveLength(2);
  client.db
    .update(eventDiscordIntegrations)
    .set({ guildId: '400000000000000009' })
    .where(eq(eventDiscordIntegrations.eventId, a.event.id))
    .run();
  expect(JSON.stringify(await call(makeComponent(`om1:door_check:${r.id}`)))).toContain(
    'Could not complete'
  );
});
const p99 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.99) - 1];
it.each(['none', 'pay_to_confirm'] as const)(
  '220 concurrent signed joins for 180 seats (%s), 429 drain and sequential reception',
  async (requirement) => {
    const f = await paidEvent(client, requirement, 180);
    client.db
      .update(eventDiscordIntegrations)
      .set({ staffRoleId: '600000000000000001' })
      .where(eq(eventDiscordIntegrations.eventId, f.event.id))
      .run();
    const inputs = await Promise.all(
      Array.from({ length: 220 }, async (_, index) => {
        const i = makeComponent(`om1:join:${f.event.id}`);
        i.token = `load-${index}`;
        i.member!.user = {
          ...i.member!.user,
          id: String(210000000000000000n + BigInt(index)),
          username: `guest-${index}`,
          global_name: `Guest ${index}`
        };
        return signedRequest(i, signingKey.privateKey);
      })
    );
    const batchStart = performance.now();
    const latencies: number[] = [];
    const results = await Promise.all(
      inputs.map(async (request) => {
        const start = performance.now();
        const response = await POST({ request } as Parameters<typeof POST>[0]);
        latencies.push(performance.now() - start);
        return response.json();
      })
    );
    expect(results.every((r) => r.type === 5)).toBe(true);
    await vi.waitFor(
      () =>
        expect(
          transport.calls.filter(
            (c) => c.method === 'PATCH' && c.url.includes('/webhooks/') && c.url.includes('/load-')
          )
        ).toHaveLength(220),
      { timeout: 15000, interval: 10 }
    );
    const replies = transport.calls
      .filter(
        (c) => c.method === 'PATCH' && c.url.includes('/webhooks/') && c.url.includes('/load-')
      )
      .map((c) => c.body);
    const completionMs = performance.now() - batchStart;
    const rows = client.db
      .select()
      .from(registrations)
      .where(eq(registrations.eventId, f.event.id))
      .all();
    const admitted = rows.filter((r) => ['confirmed', 'held'].includes(r.status));
    expect(admitted).toHaveLength(180);
    expect(rows.filter((r) => r.status === 'waitlisted')).toHaveLength(40);
    expect(replies.filter((r) => JSON.stringify(r).includes('Waitlisted'))).toHaveLength(40);
    expect(new Set(rows.map((r) => r.number)).size).toBe(220);
    expect(p99(latencies)).toBeLessThan(500);
    const checks: number[] = [];
    for (const r of admitted) {
      const i = makeComponent(`om1:door_${requirement === 'none' ? 'check' : 'cash'}:${r.id}`);
      const request = await signedRequest(i, signingKey.privateKey);
      const start = performance.now();
      const response = await POST({ request } as Parameters<typeof POST>[0]);
      checks.push(performance.now() - start);
      expect(JSON.stringify(await response.json())).toContain('Checked in by');
    }
    expect(client.db.select().from(checkinRecords).all()).toHaveLength(180);
    const attempts = new Map<string, number>();
    let limited = 0;
    const limitedAt = new Map<string, number>();
    let earlyRetries = 0;
    const gateway = createDiscordGateway('fake', {
      fetch: async (input) => {
        const path = String(input);
        const n = (attempts.get(path) ?? 0) + 1;
        attempts.set(path, n);
        if (
          n > 1 &&
          limitedAt.has(path) &&
          fixedClock.now().getTime() - limitedAt.get(path)! < 1250
        )
          earlyRetries++;
        if (n === 1 && /members\/\d*[05]\/roles/.test(path)) {
          limited++;
          limitedAt.set(path, fixedClock.now().getTime());
          return Response.json({ retry_after: 1.25 }, { status: 429 });
        }
        return new Response(null, { status: 204 });
      }
    });
    const rest = recordingRest().rest;
    const start = fixedClock.now().getTime();
    for (let pass = 0; pass < 1000; pass++) {
      await processRoleSyncBatch(
        client,
        gateway,
        undefined,
        fixedClock,
        { ...defaultTuning, OFFKAI_OUTBOX_POLL_INTERVAL_MS: 1000 },
        rest
      );
      const pending = client.db
        .select()
        .from(outboxEvents)
        .all()
        .filter((j) => j.status === 'pending');
      if (!pending.length) break;
      const due = pending.map((j) => j.nextAttemptAt?.getTime() ?? fixedClock.now().getTime());
      const next = Math.min(...due);
      fixedClock.advance(Math.max(1000, next - fixedClock.now().getTime()));
      vi.setSystemTime(fixedClock.now());
    }
    const jobs = client.db.select().from(outboxEvents).all();
    expect(limited).toBeGreaterThan(0);
    expect(earlyRetries).toBe(0);
    expect(
      jobs
        .filter((j) => j.status !== 'processed')
        .map((j) => ({
          type: j.type,
          status: j.status,
          error: j.lastError,
          next: j.nextAttemptAt,
          now: fixedClock.now()
        }))
        .slice(0, 3)
    ).toEqual([]);
    expect(jobs.filter((j) => j.type === 'discord.role_sync_requested')).toHaveLength(180);
    const drainMs = fixedClock.now().getTime() - start;
    process.stdout.write(
      `REHEARSAL ${requirement}: join ACK p99=${p99(latencies).toFixed(2)}ms, all final replies=${completionMs.toFixed(2)}ms; simulated drain=${drainMs}ms; 429s=${limited}; check-in mean=${(checks.reduce((a, b) => a + b, 0) / checks.length).toFixed(2)}ms p99=${p99(checks).toFixed(2)}ms\n`
    );
  },
  30_000
);
