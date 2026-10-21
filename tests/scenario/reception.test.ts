import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  Locale as DiscordLocale,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction
} from 'discord-api-types/v10';
import { closeDatabase, getDatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { getConfig, defaultTuning, resetConfigForTests } from '$lib/server/config';
import {
  events,
  eventDiscordIntegrations,
  checkinRecords,
  paymentRecords,
  registrations,
  outboxEvents,
  notificationDeliveries
} from '$lib/server/db/schema';
import * as restModule from '$lib/server/interactions/rest';
import { createRegistration } from '$lib/server/domain/registrations';
import { createEvent, publishEvent } from '$lib/server/domain/events';
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
async function twoEvents() {
  const f = await paidEvent(client, 'pay_to_confirm', 180);
  const r = await f.join();
  client.db.update(events).set({ title: 'P4 有料イベント' }).where(eq(events.id, f.event.id)).run();
  const other = await createEvent(
    client,
    {
      actorUserId: f.owner.userId,
      organizationId: f.org.id,
      title: 'P3 無料イベント',
      startsAt: '2027-01-02T12:00',
      timeZone: 'Asia/Tokyo',
      capacity: 180,
      registrationMode: 'auto_confirm'
    },
    undefined,
    fixedClock
  );
  client.db
    .insert(eventDiscordIntegrations)
    .values({
      eventId: other.id,
      guildId: '400000000000000001',
      createdAt: fixedClock.now(),
      updatedAt: fixedClock.now()
    })
    .run();
  await publishEvent(client, { actorUserId: f.owner.userId, eventId: other.id }, fixedClock);
  const otherJoin = () =>
    createRegistration(
      client,
      {
        organizationSlug: f.org.slug,
        eventSlug: other.slug,
        userId: f.owner.userId,
        displayName: 'Other Guest',
        locale: 'en',
        answers: []
      },
      fixedClock
    );
  return { f, r, other, otherJoin };
}
it.each(['checkin', 'status', 'remind'] as const)(
  'routes real-shaped /%s event options for an owner of two events in one organization',
  async (name) => {
    const { f, r, other } = await twoEvents();
    if (name === 'checkin') {
      // Match the live report: a paid P4 participant and a Japanese owner.
      await call(makeComponent(`om1:door_cash:${r.id}`));
      await call(makeComponent(`om1:door_undo:${r.id}`));
      client.db
        .update(registrations)
        .set({ displayNameSnapshot: 'がーと / gaato' })
        .where(eq(registrations.id, r.id))
        .run();
      const autocomplete = makeAutocomplete('001');
      autocomplete.locale = DiscordLocale.Japanese;
      autocomplete.member!.roles = [];
      autocomplete.data.options!.push({ type: 3, name: 'event', value: f.event.id });
      expect((await call(autocomplete)).data.choices).toEqual([
        { name: '001 がーと / gaato — 支払済み', value: r.id }
      ]);
    }
    const input: APIChatInputApplicationCommandInteraction = {
      ...makeChatInput(name === 'checkin' ? 'checkin' : 'offkai'),
      data: {
        id: '700000000000000001',
        type: 1,
        name: name === 'checkin' ? 'checkin' : 'offkai',
        options:
          name === 'checkin'
            ? [
                { type: 3, name: 'who', value: r.id },
                { type: 3, name: 'event', value: f.event.id }
              ]
            : [{ type: 1, name, options: [{ type: 3, name: 'event', value: f.event.id }] }]
      }
    };
    if (name === 'checkin') input.locale = DiscordLocale.Japanese;
    input.member!.roles = []; // Owner authorization, without a Discord staff role.
    const expected =
      name === 'checkin' ? 'door_check' : name === 'status' ? 'Held: 1' : 'Held: 1, confirmed: 0';
    expect(JSON.stringify(await call(input))).toContain(expected);
    if (name === 'checkin') {
      input.data.options!.reverse(); // Discord option order must not affect extraction.
      expect(JSON.stringify(await call(input))).toContain(expected);
    } else {
      expect(JSON.stringify(await call(command(name, other.id)))).toContain('Held: 0');
      expect(JSON.stringify(await call(command(name)))).toContain('Choose an event');
    }
  }
);
it('searches authorized events together, preserves state labels and resolves the selected registration event', async () => {
  const { f, r, other, otherJoin } = await twoEvents();
  const second = await discordEvent(client);
  // Another organization is visible to its owner, but not a staff actor for P4 only.
  const secondRegistration = await otherJoin();
  client.db
    .update(registrations)
    .set({ number: 42 })
    .where(eq(registrations.id, secondRegistration.id))
    .run();
  const auto = await call(makeAutocomplete(''));
  expect(auto.data.choices).toEqual([
    expect.objectContaining({
      value: r.id,
      name: expect.stringContaining('P4 有料イベント · 001 Participant — Unpaid')
    }),
    expect.objectContaining({
      value: secondRegistration.id,
      name: expect.stringContaining('P3 無料イベント · 042 Other Guest — No payment required')
    })
  ]);
  for (const query of ['1', '001', 'tici']) {
    const result = await call(makeAutocomplete(query));
    expect(result.data.choices).toHaveLength(1);
    expect(result.data.choices[0].value).toBe(r.id);
  }
  expect(JSON.stringify(await call(command('checkin', undefined, r.id)))).toContain('door_cash');
  expect(
    JSON.stringify(await call(command('checkin', undefined, secondRegistration.id)))
  ).toContain('door_check');
  const filtered = makeAutocomplete('');
  filtered.data.options!.push({ type: 3, name: 'event', value: other.id });
  expect((await call(filtered)).data.choices).toEqual([
    { value: secondRegistration.id, name: '042 Other Guest — No payment required' }
  ]);
  expect(JSON.stringify(await call(command('checkin', other.id, r.id)))).toContain(
    'Could not complete'
  );
  client.db
    .update(eventDiscordIntegrations)
    .set({ staffRoleId: '600000000000000001' })
    .where(eq(eventDiscordIntegrations.eventId, f.event.id))
    .run();
  const staffSearch = makeAutocomplete('');
  staffSearch.member!.user = {
    ...staffSearch.member!.user,
    id: '200000000000000099',
    username: 'staff'
  };
  expect(
    (await call(staffSearch)).data.choices.map((choice: { value: string }) => choice.value)
  ).toEqual([r.id]);
  staffSearch.data.options!.push({ type: 3, name: 'event', value: second.event.id });
  expect((await call(staffSearch)).data.choices).toEqual([]);
  const forged = command('checkin', undefined, secondRegistration.id);
  forged.member!.user = staffSearch.member!.user;
  expect(JSON.stringify(await call(forged))).toContain('requires the event staff role');
});
it('caps cross-event autocomplete at 25, ranks exact numbers first and keeps long labels within Discord limits', async () => {
  const { f, r, otherJoin } = await twoEvents();
  client.db
    .update(events)
    .set({ title: 'P4 ' + '有料イベント'.repeat(30) })
    .where(eq(events.id, f.event.id))
    .run();
  client.db
    .update(registrations)
    .set({ displayNameSnapshot: '42 ' + 'Long name'.repeat(20) })
    .where(eq(registrations.id, r.id))
    .run();
  for (let n = 0; n < 26; n++) {
    const row = n === 0 ? await otherJoin() : await f.join(String(220000000000000000n + BigInt(n)));
    client.db
      .update(registrations)
      .set({
        displayNameSnapshot: '42 Guest',
        ...(n === 0 ? { number: 42 } : {})
      })
      .where(eq(registrations.id, row.id))
      .run();
  }
  const choices = (await call(makeAutocomplete('42'))).data.choices;
  expect(choices).toHaveLength(25);
  expect(choices[0].name).toContain('P3 無料イベント · 042');
  expect(choices[1].value).toBe(r.id);
  expect(
    choices.every(
      (choice: { name: string }) =>
        choice.name.length <= 100 && / — (Paid|Unpaid|No payment required)$/.test(choice.name)
    )
  ).toBe(true);
});
it.each([DiscordLocale.EnglishUS, DiscordLocale.Japanese] as const)(
  'distinguishes event ambiguity from missing permission (%s)',
  async (locale) => {
    const { f } = await twoEvents();
    const missing = command('status');
    missing.locale = locale;
    expect(JSON.stringify(await call(missing))).toContain(
      locale === 'ja' ? 'イベントを選んでください。' : 'Choose an event.'
    );
    missing.member!.user = {
      ...missing.member!.user,
      id: '200000000000000099',
      username: 'outsider'
    };
    missing.data.options = [
      { type: 1, name: 'status', options: [{ type: 3, name: 'event', value: f.event.id }] }
    ];
    const rejection = JSON.stringify(await call(missing));
    expect(rejection).toContain(
      locale === 'ja'
        ? 'この操作にはイベントのスタッフロールまたは主催者権限が必要です。'
        : 'This action requires the event staff role or organizer permission.'
    );
    expect(rejection).not.toContain(locale === 'ja' ? 'イベントを選んで' : 'Choose an event');
  }
);
function selectEvent(name: 'status' | 'remind', values: string[]) {
  const interaction = makeComponent();
  interaction.message.flags = 64 | 32768;
  interaction.data = { component_type: 3, custom_id: `om1:reception_pick:${name}`, values };
  return interaction;
}
it.each(['status', 'remind'] as const)(
  'rechecks organizer permission and guild binding when choosing %s',
  async (name) => {
    const { f } = await twoEvents();
    await call(command(name));
    const jobs = client.db.select().from(outboxEvents).all().length;
    const denied = selectEvent(name, [f.event.id]);
    denied.member!.user = {
      ...denied.member!.user,
      id: '200000000000000099',
      username: 'staff-only'
    };
    client.db
      .update(eventDiscordIntegrations)
      .set({ staffRoleId: '600000000000000001' })
      .where(eq(eventDiscordIntegrations.eventId, f.event.id))
      .run();
    const noOrganizer = await call(denied);
    expect(noOrganizer.type).toBe(7);
    expect(JSON.stringify(noOrganizer)).toContain('requires the event staff role');
    client.db
      .update(eventDiscordIntegrations)
      .set({ guildId: '400000000000000009' })
      .where(eq(eventDiscordIntegrations.eventId, f.event.id))
      .run();
    const rebound = await call(selectEvent(name, [f.event.id]));
    expect(rebound.type).toBe(7);
    expect(JSON.stringify(rebound)).toContain('requires the event staff role');
    expect(client.db.select().from(outboxEvents).all()).toHaveLength(jobs);
  }
);
it.each(['status', 'remind'] as const)(
  'offers an ephemeral event select for %s and updates that message after choosing',
  async (name) => {
    const { f, other } = await twoEvents();
    const picker = await call(command(name));
    expect(picker.type).toBe(4);
    expect(picker.data.flags).toBe(64 | 32768);
    const select = picker.data.components
      .flatMap(
        (component: {
          components?: { type: number; custom_id: string; options: { value: string }[] }[];
        }) => component.components ?? []
      )
      .find((component: { type: number }) => component.type === 3);
    expect(select).toBeDefined();
    expect(select.custom_id).toBe(`om1:reception_pick:${name}`);
    expect(select.options.map((option: { value: string }) => option.value)).toEqual([
      f.event.id,
      other.id
    ]);
    const choose = selectEvent(name, [f.event.id]);
    choose.message.components = picker.data.components;
    const result = await call(choose);
    expect(result.type).toBe(7);
    expect(result.data.flags).toBe(32768);
    expect(JSON.stringify(result)).toContain('Held: 1');
    expect(JSON.stringify(result)).not.toContain('om1:reception_pick:');
    if (name === 'remind') {
      const confirm = JSON.stringify(result).match(/om1:remind_confirm:[a-f0-9-]+/)![0];
      const click = makeComponent(confirm);
      click.message.flags = 64 | 32768;
      click.message.components = result.data.components;
      const confirmed = await call(click);
      expect(confirmed.type).toBe(7);
      expect(JSON.stringify(confirmed)).toContain('Queued 1 reminders');
      expect(JSON.stringify(confirmed)).not.toContain('om1:remind_confirm:');
    }
    expect(transport.calls).toHaveLength(0);
  }
);
it('pages more than 25 organizer events in place and can select an event from the last page', async () => {
  const { other } = await twoEvents();
  const template = client.db.select().from(events).where(eq(events.id, other.id)).get()!;
  for (let n = 0; n < 24; n++) {
    const id = crypto.randomUUID();
    client.db
      .insert(events)
      .values({ ...template, id, slug: `page-${n}`, title: `Event ${n}` })
      .run();
    client.db
      .insert(eventDiscordIntegrations)
      .values({
        eventId: id,
        guildId: '400000000000000001',
        createdAt: fixedClock.now(),
        updatedAt: fixedClock.now()
      })
      .run();
  }
  const first = await call(command('status'));
  const initial = first.data.components[1].components[0];
  expect(initial.options).toHaveLength(25);
  const next = first.data.components[2].components[0].custom_id;
  expect(next).toBe('om1:reception_page:status:1');
  const page = await call(makeComponent(next));
  expect(page.type).toBe(7);
  const last = page.data.components[1].components[0];
  expect(last.options).toHaveLength(1);
  expect(
    new Set([...initial.options, ...last.options].map((option: { value: string }) => option.value))
      .size
  ).toBe(26);
  const back = await call(makeComponent(page.data.components[2].components[0].custom_id));
  expect(back.type).toBe(7);
  expect(back.data.components[1].components[0].options).toEqual(initial.options);
  const result = await call(selectEvent('status', [last.options[0].value]));
  expect(result.type).toBe(7);
  expect(JSON.stringify(result)).toContain('Held: 0');
  expect(JSON.stringify(result)).not.toContain('om1:reception_pick:');
});
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
  const initial = await call(staff(command('checkin', undefined, r.id)));
  expect(initial.type).toBe(4);
  expect(initial.data.flags).toBe(64 | 32768);
  const card = JSON.stringify(initial);
  expect(card).toContain('Received');
  expect(card).toContain('door_cash');
  const outsider = staff(makeComponent(`om1:door_cash:${r.id}`));
  outsider.member!.roles = [];
  expect(JSON.stringify(await call(outsider))).toContain('requires the event staff role');
  expect(client.db.select().from(paymentRecords).all()).toHaveLength(0);
  for (const method of ['cash', 'cash', 'paypay', 'check']) {
    const result = await call(staff(makeComponent(`om1:door_${method}:${r.id}`)));
    expect(result.type).toBe(7);
    expect(result.data.flags).toBe(32768);
  }
  expect(client.db.select().from(checkinRecords).all()).toHaveLength(1);
  expect(client.db.select().from(paymentRecords).all()).toHaveLength(1);
  expect(JSON.stringify(await call(staff(command('checkin', undefined, r.id))))).toContain(
    'Checked in by'
  );
  expect((await call(staff(makeComponent(`om1:door_undo:${r.id}`)))).type).toBe(7);
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
  const confirmed = await call(makeComponent(confirm));
  expect(confirmed.type).toBe(7);
  expect(confirmed.data.flags).toBe(32768);
  expect(JSON.stringify(confirmed)).toContain('Queued 1 reminders');
  expect(JSON.stringify(confirmed)).not.toContain('om1:remind_confirm:');
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
it('resolves registration choices across open events and rechecks guild bindings', async () => {
  const a = await paidEvent(client, 'none', 180);
  const r = await a.join();
  await discordEvent(client);
  expect(JSON.stringify(await call(command('checkin', undefined, r.id)))).toContain('door_check');
  expect(JSON.stringify(await call(command('checkin', undefined, '001')))).toContain(
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
    'requires the event staff role'
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
