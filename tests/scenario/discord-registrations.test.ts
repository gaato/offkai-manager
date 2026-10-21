import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
  Locale
} from 'discord-api-types/v10';
import { defaultTuning, getConfig, resetConfigForTests } from '$lib/server/config';
import { closeDatabase, getDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  discordPanels,
  eventDiscordIntegrations,
  events,
  interactionDrafts,
  outboxEvents,
  registrations,
  registrationFormAnswers,
  organizationMemberships
} from '$lib/server/db/schema';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import { enqueuePanelRefresh } from '$lib/server/domain/discord/outbox';
import { write } from '$lib/server/db/client';
import { processRoleSyncBatch } from '$lib/server/worker/role-sync';
import * as restModule from '$lib/server/interactions/rest';
import { archiveField } from '$lib/server/domain/events';
import { excerpt } from '$lib/server/interactions/renderers';
import { discordEvent } from '../support/discord-registration';
import { recordingRest, responseLike } from '../support/discord-rest';
import {
  actor,
  callInteraction,
  makeChatInput,
  makeComponent,
  makeModalSubmit,
  makeAutocomplete
} from '../support/interactions';
import { signingKey } from '../support/scenario-setup';
import { fixedClock } from '../database';

function participant<T extends APIMessageComponentInteraction | APIModalSubmitInteraction>(
  interaction: T,
  id = '200000000000000002'
): T {
  return {
    ...interaction,
    member: {
      ...interaction.member!,
      user: { ...actor, id, username: 'participant', global_name: 'Participant' }
    }
  };
}
function panelCommand(eventId: string, language = 'en') {
  const command = makeChatInput('offkai', 'panel');
  command.data.options = [
    {
      type: 1,
      name: 'panel',
      options: [
        { type: 3, name: 'event', value: eventId },
        { type: 3, name: 'language', value: language }
      ]
    }
  ];
  return command;
}

function button(action: string, eventId: string, id?: string) {
  return participant(makeComponent(`om1:${action}:${eventId}`), id);
}
function submit(eventId: string, answers: Record<string, string>, kind = 'join', id?: string) {
  const modal = participant(makeModalSubmit(`om1:${kind}_submit:${eventId}`), id);
  modal.data.components = Object.entries(answers).map(([key, value]) => ({
    type: 18,
    component: { type: 4, custom_id: `field:${key}`, value }
  }));
  return modal;
}
describe('signed FREE event Discord journeys', () => {
  let client: DatabaseClient;
  let transport: ReturnType<typeof recordingRest>;
  async function call(interaction: Parameters<typeof callInteraction>[0]) {
    const offset = transport.calls.length;
    const response = await callInteraction(interaction, signingKey.privateKey);
    expect(response.status).toBe(200);
    const data = await response.json();
    if (
      data.type === 5 &&
      typeof interaction !== 'string' &&
      (interaction.type === 3 || interaction.type === 5)
    ) {
      await vi.waitFor(() =>
        expect(
          transport.calls
            .slice(offset)
            .some((c) => c.method === 'PATCH' && c.url.includes('/webhooks/'))
        ).toBe(true)
      );
      const final = transport.calls
        .slice(offset)
        .find((c) => c.method === 'PATCH' && c.url.includes('/webhooks/'))!.body as {
        flags: number;
      };
      return { type: 4, data: { ...final, flags: 64 | 32768 } };
    }
    return data;
  }

  beforeEach(() => {
    vi.stubEnv('OFFKAI_DISCORD_BOT_TOKEN', 'fake-test-token');
    resetConfigForTests();
    client = getDatabaseClient(getConfig());
    runMigrations(client);
    transport = recordingRest();
    vi.spyOn(restModule, 'getInteractionRest').mockReturnValue(transport.rest);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.stubEnv('OFFKAI_DISCORD_BOT_TOKEN', undefined);
    resetConfigForTests();
    await closeDatabase(client);
  });
  it('posts a V2 panel by bot REST, persists its language, then completes the deferred reply', async () => {
    const { event } = await discordEvent(client);
    expect(await call(panelCommand(event.id, 'ja'))).toMatchObject({
      type: 5,
      data: { flags: 64 }
    });
    await vi.waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(transport.calls[0]).toMatchObject({
      method: 'POST',
      body: { flags: 32768, allowed_mentions: { parse: [] }, components: [{ type: 17 }] }
    });
    expect(JSON.stringify(transport.calls[0].body)).toContain('参加する');
    expect(transport.calls[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.stringify(transport.calls[1].body)).toContain('posted');
    expect(client.db.select().from(discordPanels).get()).toMatchObject({
      eventId: event.id,
      guildId: '400000000000000001',
      locale: 'ja',
      deletedAt: null
    });
  });
  it('keeps one active panel per language and returns its link when reposted', async () => {
    const { event } = await discordEvent(client);
    await call(panelCommand(event.id, 'ja'));
    await vi.waitFor(() => expect(transport.calls).toHaveLength(2));
    const repeated = await call(panelCommand(event.id, 'ja'));
    expect(repeated).toMatchObject({ type: 4 });
    expect(JSON.stringify(repeated)).toContain('already posted');
    expect(JSON.stringify(repeated)).toContain('https://discord.com/channels/');
    expect(transport.calls).toHaveLength(2);
    await call(panelCommand(event.id, 'en'));
    await vi.waitFor(() => expect(transport.calls).toHaveLength(4));
    expect(
      client.db
        .select()
        .from(discordPanels)
        .all()
        .map((row) => row.locale)
        .sort()
    ).toEqual(['en', 'ja']);
  });
  it('cleans up a concurrent duplicate panel after the database chooses one active message', async () => {
    const { event } = await discordEvent(client);
    let release: () => void = () => {};
    let posts = 0;
    const allowPosts = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport = recordingRest(async (request) => {
      if (request.method !== 'POST') return responseLike({});
      const index = ++posts;
      await allowPosts;
      return responseLike({ id: String(800000000000000000n + BigInt(index)) });
    });
    vi.spyOn(restModule, 'getInteractionRest').mockReturnValue(transport.rest);
    const responses = await Promise.all([
      call(panelCommand(event.id)),
      call(panelCommand(event.id))
    ]);
    release();
    expect(responses.every((response) => response.type === 5)).toBe(true);
    await vi.waitFor(() => expect(transport.calls).toHaveLength(5));
    expect(client.db.select().from(discordPanels).all()).toHaveLength(1);
    expect(transport.calls.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  });
  it('autocomplete matches titles, caps at 25, and excludes other guilds and unmanaged organizations', async () => {
    const fixture = await discordEvent(client);
    for (let i = 0; i < 28; i++) {
      const [copy] = client.db
        .insert(events)
        .values({
          ...fixture.event,
          id: crypto.randomUUID(),
          title: `Matching ${i}`,
          slug: `matching-${i}`
        })
        .returning()
        .all();
      client.db
        .insert(eventDiscordIntegrations)
        .values({ eventId: copy.id, guildId: '400000000000000001' })
        .run();
    }
    const otherGuild = await discordEvent(client, { guild: '400000000000000009' });
    client.db
      .update(events)
      .set({ title: 'Matching other server' })
      .where(eq(events.id, otherGuild.event.id))
      .run();
    const autocomplete = makeAutocomplete('Matching');
    autocomplete.data.name = 'offkai';
    autocomplete.data.options = [
      {
        type: 1,
        name: 'panel',
        options: [{ type: 3, name: 'event', value: 'Matching', focused: true }]
      }
    ];
    const response = await call(autocomplete);
    expect(response.type).toBe(8);
    expect(response.data.choices).toHaveLength(25);
    expect(
      response.data.choices.every((choice: { name: string }) => choice.name.startsWith('Matching'))
    ).toBe(true);
    expect(JSON.stringify(response)).not.toContain('other server');
    autocomplete.member!.user = { ...actor, id: '200000000000000099' };
    expect(await call(autocomplete)).toEqual({ type: 8, data: { choices: [] } });
  });
  it('reports missing permission 50013 in the deferred reply without storing a panel', async () => {
    const { event } = await discordEvent(client);
    // Stop spying while constructing another fake client, then install that instance.
    vi.restoreAllMocks();
    transport = recordingRest((request) =>
      request.method === 'POST'
        ? responseLike({ code: 50013, message: 'Missing Permissions' }, 403)
        : responseLike({})
    );
    vi.spyOn(restModule, 'getInteractionRest').mockReturnValue(transport.rest);
    expect(await call(panelCommand(event.id))).toMatchObject({ type: 5 });
    await vi.waitFor(() => expect(transport.calls).toHaveLength(2));
    expect(JSON.stringify(transport.calls[1].body)).toContain('50013');
    expect(client.db.select().from(discordPanels).all()).toHaveLength(0);
  });
  it('joins immediately, assigns a reception number, enqueues roles and panel refresh; joining twice shows status', async () => {
    const { event } = await discordEvent(client);
    const response = await call(button('join', event.id));
    expect(response).toMatchObject({ type: 4, data: { flags: 64 | 32768 } });
    expect(JSON.stringify(response)).toContain('# 001');
    expect(client.db.select().from(registrations).all()).toMatchObject([
      { status: 'confirmed', number: 1 }
    ]);
    expect(
      client.db
        .select()
        .from(outboxEvents)
        .all()
        .map((row) => row.type)
        .sort()
    ).toEqual(['discord.role_sync_requested', 'panel.refresh']);
    expect(JSON.stringify(await call(button('join', event.id)))).toContain('# 001');
    expect(client.db.select().from(registrations).all()).toHaveLength(1);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls.every((c) => c.method === 'PATCH' && c.url.includes('/webhooks/'))).toBe(
      true
    );
  });
  it('joins through a modal, validates every field, and stores answers', async () => {
    const { event, fields } = await discordEvent(client, { fields: [{ label: 'Name' }] });
    const response = await call(button('join', event.id));
    expect(response).toMatchObject({
      type: 9,
      data: {
        custom_id: `om1:join_submit:${event.id}`,
        components: [{ type: 18, component: { type: 4 } }]
      }
    });
    expect(JSON.stringify(await call(submit(event.id, { [fields[0].key]: 'My name' })))).toContain(
      'Participation confirmed'
    );
    expect(client.db.select().from(registrationFormAnswers).get()!.valueText).toBe('My name');
    expect(client.db.select().from(registrations).get()!.status).toBe('confirmed');
  });
  it('preserves rejected answers, retries prefilled, accepts corrections, and clears the draft', async () => {
    const { event, fields } = await discordEvent(client, {
      fields: [{ label: 'Name' }, { label: 'Required answer' }]
    });
    const rejected = await call(
      submit(event.id, { [fields[0].key]: 'Keep my answer', [fields[1].key]: '' })
    );
    expect(JSON.stringify(rejected)).toContain(`om1:retry_join:${event.id}`);
    expect(client.db.select().from(registrations).all()).toHaveLength(0);
    expect(client.db.select().from(interactionDrafts).get()!.payloadJson[fields[0].key]).toBe(
      'Keep my answer'
    );
    const retried = await call(button('retry_join', event.id));
    expect(retried).toMatchObject({ type: 9 });
    expect(JSON.stringify(retried)).toContain('Keep my answer');
    await call(
      submit(event.id, { [fields[0].key]: 'Keep my answer', [fields[1].key]: 'Corrected' })
    );
    expect(client.db.select().from(registrations).all()).toHaveLength(1);
    expect(client.db.select().from(interactionDrafts).all()).toHaveLength(0);
  });
  it('preserves an invalid edit and recovers its answers as a new join after cancellation', async () => {
    const { event, fields } = await discordEvent(client, {
      fields: [{ label: 'Name' }, { label: 'Required' }]
    });
    await call(
      submit(event.id, { [fields[0].key]: 'Original', [fields[1].key]: 'Required answer' })
    );
    const invalid = await call(
      submit(event.id, { [fields[0].key]: 'Keep edited text', [fields[1].key]: '' }, 'edit')
    );
    expect(JSON.stringify(invalid)).toContain('Enter a value.');
    expect(JSON.stringify(invalid)).toContain('om1:retry_edit:');
    expect(JSON.stringify(await call(button('retry_edit', event.id)))).toContain(
      'Keep edited text'
    );
    await call(button('cancel_confirm', event.id));
    const recovered = await call(button('retry_edit', event.id));
    expect(recovered).toMatchObject({
      type: 9,
      data: { custom_id: `om1:join_submit:${event.id}` }
    });
    expect(JSON.stringify(recovered)).toContain('Keep edited text');
    await call(
      submit(event.id, { [fields[0].key]: 'Keep edited text', [fields[1].key]: 'Corrected' })
    );
    const registrationsAfter = client.db.select().from(registrations).all();
    expect(registrationsAfter.filter((row) => row.status === 'confirmed')).toHaveLength(1);
    expect(registrationsAfter.find((row) => row.status === 'confirmed')!.number).toBe(2);
    expect(client.db.select().from(interactionDrafts).all()).toHaveLength(0);
  });
  it('a second modal submit shows status instead of creating another registration', async () => {
    const { event, fields } = await discordEvent(client, { fields: [{ label: 'Name' }] });
    const modal = submit(event.id, { [fields[0].key]: 'Saved once' });
    await call(modal);
    expect(JSON.stringify(await call(modal))).toContain('# 001');
    expect(client.db.select().from(registrations).all()).toHaveLength(1);
  });
  it.each(['en-US', 'ja'] as const)(
    'does not claim to save answers when Join rejects before the modal (%s)',
    async (locale) => {
      const { event } = await discordEvent(client, { fields: [{ label: 'Name' }] });
      client.db
        .update(events)
        .set({ registrationOpensAt: new Date('2026-12-01T00:00:00Z') })
        .where(eq(events.id, event.id))
        .run();
      const interaction = button('join', event.id);
      interaction.locale = locale as Locale;
      const response = await call(interaction);
      expect(response).toMatchObject({ type: 4 });
      expect(JSON.stringify(response)).toContain(
        locale === 'ja' ? '現在は受付時間外です。' : 'Registration is not open.'
      );
      expect(JSON.stringify(response)).not.toMatch(/saved|保存/);
      expect(client.db.select().from(interactionDrafts).all()).toHaveLength(0);
    }
  );

  it.each(['ja', 'en-US', 'fr'] as const)(
    'persists Discord locale on join and changes it on answer edit (%s)',
    async (locale) => {
      const { event, fields } = await discordEvent(client, { fields: [{ label: 'Name' }] });
      const joining = submit(event.id, { [fields[0].key]: 'Participant' });
      joining.locale = locale as Locale;
      await call(joining);
      expect(client.db.select().from(registrations).get()!.locale).toBe(
        locale === 'ja' ? 'ja' : 'en'
      );
      const editing = submit(event.id, { [fields[0].key]: 'Edited' }, 'edit');
      editing.locale = (locale === 'ja' ? 'en-US' : 'ja') as Locale;
      await call(editing);
      expect(client.db.select().from(registrations).get()!.locale).toBe(
        locale === 'ja' ? 'en' : 'ja'
      );
    }
  );

  it('preserves answers when the registration window closes between opening and submitting', async () => {
    const { event, fields } = await discordEvent(client, { fields: [{ label: 'Name' }] });
    await call(button('join', event.id));
    client.db
      .update(events)
      .set({ registrationClosesAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(events.id, event.id))
      .run();
    const response = await call(submit(event.id, { [fields[0].key]: 'Still saved' }));
    expect(JSON.stringify(response)).toContain('Your submitted answers are saved');
    expect(client.db.select().from(interactionDrafts).get()!.payloadJson[fields[0].key]).toBe(
      'Still saved'
    );
    expect(await call(button('retry_join', event.id))).toMatchObject({ type: 9 });
  });
  it('shows localized waitlist status at capacity and pending approval for approval mode', async () => {
    const auto = await discordEvent(client, { capacity: 1 });
    await call(button('join', auto.event.id));
    const second = button('join', auto.event.id, '200000000000000003');
    second.locale = 'ja' as Locale;
    expect(JSON.stringify(await call(second))).toContain('キャンセル待ち');
    expect(
      client.db
        .select()
        .from(registrations)
        .all()
        .filter((r) => r.status === 'confirmed')
    ).toHaveLength(1);
    const approval = await discordEvent(client, { mode: 'approval' });
    expect(JSON.stringify(await call(button('join', approval.event.id)))).toContain(
      'organizer approval'
    );
  });
  it('cancels in two steps and reconciles participant-role removal through fake REST', async () => {
    const { event } = await discordEvent(client);
    await call(button('join', event.id));
    const confirm = await call(button('cancel', event.id));
    expect(JSON.stringify(confirm)).toContain(`om1:cancel_confirm:${event.id}`);
    expect(JSON.stringify(confirm)).toContain('Contact the organizer');
    expect(client.db.select().from(registrations).get()!.status).toBe('confirmed');
    expect(JSON.stringify(await call(button('cancel_confirm', event.id)))).toContain('cancelled');
    expect(client.db.select().from(registrations).get()!.status).toBe('cancelled');
    expect(
      client.db
        .select()
        .from(outboxEvents)
        .all()
        .filter((row) => row.type === 'discord.role_sync_requested')
    ).toHaveLength(2);
    const gateway = createDiscordGateway('fake-test-token', { rest: transport.rest });
    await processRoleSyncBatch(
      client,
      gateway,
      undefined,
      fixedClock,
      defaultTuning,
      transport.rest
    );
    expect(
      transport.calls.some(
        (request) => request.method === 'DELETE' && request.url.includes('/roles/')
      )
    ).toBe(true);
  });
  it('edits active fields without removing archived snapshots or truncating an unchanged legacy long answer', async () => {
    const { event, fields, owner } = await discordEvent(client, {
      fields: [
        { label: 'Archived question' },
        { label: 'Long answer', type: 'textarea' },
        { label: 'Active answer' }
      ]
    });
    await call(
      submit(event.id, {
        [fields[0].key]: 'Historical answer',
        [fields[1].key]: 'Old text',
        [fields[2].key]: 'Before'
      })
    );
    const legacyLong = 'x'.repeat(5_000);
    client.db
      .update(registrationFormAnswers)
      .set({ valueText: legacyLong })
      .where(eq(registrationFormAnswers.fieldId, fields[1].id))
      .run();
    await archiveField(
      client,
      { actorUserId: owner.userId, eventId: event.id, fieldId: fields[0].id },
      fixedClock
    );
    const modal = await call(button('edit', event.id));
    expect(modal.type).toBe(9);
    await call(
      submit(
        event.id,
        { [fields[1].key]: excerpt(legacyLong, 4_000), [fields[2].key]: 'After' },
        'edit'
      )
    );
    const answers = client.db.select().from(registrationFormAnswers).all();
    expect(answers.find((row) => row.fieldId === fields[0].id)!.valueText).toBe(
      'Historical answer'
    );
    expect(answers.find((row) => row.fieldId === fields[1].id)!.valueText).toBe(legacyLong);
    expect(answers.find((row) => row.fieldId === fields[2].id)!.valueText).toBe('After');
  });
  it('edits only the actor’s answers through a prefilled modal', async () => {
    const { event, fields } = await discordEvent(client, { fields: [{ label: 'Name' }] });
    await call(submit(event.id, { [fields[0].key]: 'Original' }));
    const before = client.db.select().from(registrations).get()!;
    const modal = await call(button('edit', event.id));
    expect(modal).toMatchObject({ type: 9, data: { custom_id: `om1:edit_submit:${event.id}` } });
    expect(JSON.stringify(modal)).toContain('Original');
    await call(submit(event.id, { [fields[0].key]: 'Edited' }, 'edit'));
    expect(client.db.select().from(registrations).get()).toMatchObject({
      id: before.id,
      number: before.number,
      status: 'confirmed'
    });
    expect(client.db.select().from(registrationFormAnswers).get()!.valueText).toBe('Edited');
    const other = await call(button('edit', event.id, '200000000000000004'));
    expect(other).toMatchObject({ type: 4 });
    expect(JSON.stringify(other)).not.toContain('Edited');
  });
  it.each(['join', 'status', 'edit', 'cancel', 'cancel_confirm', 'retry_join', 'retry_edit'])(
    'rejects %s from a different guild',
    async (action) => {
      const { event } = await discordEvent(client);
      const interaction = button(action, event.id);
      interaction.guild_id = '400000000000000009';
      expect(JSON.stringify(await call(interaction))).toContain('configured Discord server');
      expect(client.db.select().from(registrations).all()).toHaveLength(0);
      expect(transport.calls).toHaveLength(0);
    }
  );
  it('re-checks organization role for panel commands independently of server permissions', async () => {
    const { event, owner } = await discordEvent(client);
    client.db
      .update(organizationMemberships)
      .set({ role: 'staff' })
      .where(eq(organizationMemberships.userId, owner.userId))
      .run();
    expect(JSON.stringify(await call(panelCommand(event.id)))).toContain('Only an organizer');
    expect(transport.calls).toHaveLength(0);
  });
  it('returns clear errors for unconfigured and mismatched guilds', async () => {
    const { event } = await discordEvent(client, { guild: '' });
    expect(JSON.stringify(await call(panelCommand(event.id)))).toContain('no Discord server');
    client.db.update(eventDiscordIntegrations).set({ guildId: '400000000000000009' }).run();
    expect(JSON.stringify(await call(panelCommand(event.id)))).toContain(
      'configured Discord server'
    );
  });
  it('marks a panel deleted when its PATCH receives 404/10008', async () => {
    const { event } = await discordEvent(client);
    client.db
      .insert(discordPanels)
      .values({
        eventId: event.id,
        guildId: '400000000000000001',
        channelId: '500000000000000001',
        messageId: '800000000000000001',
        locale: 'en'
      })
      .run();
    write(client, (tx) => enqueuePanelRefresh(tx, event.id, fixedClock));
    vi.restoreAllMocks();
    const fake = recordingRest(() =>
      responseLike({ code: 10008, message: 'Unknown Message' }, 404)
    );
    await processRoleSyncBatch(
      client,
      createDiscordGateway('fake-test-token', { rest: fake.rest }),
      undefined,
      fixedClock,
      defaultTuning,
      fake.rest
    );
    expect(client.db.select().from(discordPanels).get()!.deletedAt).toEqual(fixedClock.now());
    expect(client.db.select().from(outboxEvents).get()!.status).toBe('processed');
  });
});
