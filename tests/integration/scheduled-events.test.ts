import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase, fixedClock } from '../database';
import { discordEvent, guildId } from '../support/discord-registration';
import { setupResources, setupBotId, setupBotRoleId } from '../support/discord-setup';
import { recordingRest, responseLike } from '../support/discord-rest';
import { setScheduledEvent, scheduledPermissions } from '$lib/server/domain/discord/scheduled';
import { syncScheduledEvent, scheduledStateSchema } from '$lib/server/worker/scheduled-events';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import { discordPanels, events, eventDiscordIntegrations } from '$lib/server/db/schema';
import { cancelEvent } from '$lib/server/domain/events';
import { processRoleSyncBatch } from '$lib/server/worker/role-sync';
import { defaultTuning } from '$lib/server/config';
let client: ReturnType<typeof testDatabase>;
beforeEach(() => {
  client = testDatabase();
});
afterEach(() => client.db.$client.close());
it.each([false, true])(
  'checks permissions, recovers create, updates and cancels via outbox (active=%s)',
  async (active) => {
    const f = await discordEvent(client);
    const resources = setupResources();
    const gateway = {
      ...createDiscordGateway('fake', { fetch: async () => Response.json({}) }),
      enabled: true,
      isGuildMember: async () => true,
      addGuildMemberRole: async () => {},
      removeGuildMemberRole: async () => {},
      canManageGuild: async () => true,
      getGuildName: async () => '',
      getGuildResources: async () => resources
    };
    await expect(
      setScheduledEvent(client, gateway, f.event.id, f.owner.userId, true, fixedClock)
    ).rejects.toMatchObject({ code: 'forbidden' });
    resources.roles.find((r) => r.id === setupBotRoleId)!.permissions =
      String(scheduledPermissions);
    client.db
      .insert(discordPanels)
      .values({
        eventId: f.event.id,
        guildId,
        channelId: '500000000000000001',
        messageId: '800000000000000001',
        locale: 'en'
      })
      .run();
    await setScheduledEvent(client, gateway, f.event.id, f.owner.userId, true, fixedClock);
    let remoteStatus = 1;
    let saved: { id: string; name: string; description: string; creator_id: string } | undefined;
    const { rest, calls } = recordingRest((call) => {
      if (call.method === 'GET' && /scheduled-events\/\d+$/.test(call.url))
        return responseLike({ status: remoteStatus });
      if (call.method === 'GET' && call.url.endsWith('/scheduled-events'))
        return responseLike(saved ? [saved] : []);
      if (call.method === 'POST' && call.url.endsWith('/scheduled-events')) {
        const body = call.body as { name: string; description: string };
        saved = { id: '900000000000000001', ...body, creator_id: setupBotId };
        return responseLike(saved);
      }
      return responseLike({});
    });
    // REST itself retries transport failures; force all create attempts to fail once by rejecting POST at the public boundary.
    const original = rest.post.bind(rest);
    let lose = true;
    rest.post = async (route, options) => {
      const value = await original(route, options);
      if (lose) {
        lose = false;
        throw new Error('lost response');
      }
      return value;
    };
    await expect(
      syncScheduledEvent(client, rest, gateway, f.event.id, fixedClock)
    ).rejects.toThrow();
    await syncScheduledEvent(client, rest, gateway, f.event.id, fixedClock);
    expect(
      calls.filter((c) => c.method === 'POST' && c.url.endsWith('/scheduled-events'))
    ).toHaveLength(1);
    expect(saved?.description).toContain('https://discord.com/channels/');
    client.db
      .update(events)
      .set({ title: 'Changed event', venueName: 'Hall' })
      .where(eq(events.id, f.event.id))
      .run();
    await syncScheduledEvent(client, rest, gateway, f.event.id, fixedClock);
    expect(
      calls.some((c) => c.method === 'PATCH' && JSON.stringify(c.body).includes('Changed event'))
    ).toBe(true);
    remoteStatus = active ? 2 : 1;
    await cancelEvent(
      client,
      { actorUserId: f.owner.userId, eventId: f.event.id, reason: 'cancel' },
      fixedClock
    );
    await processRoleSyncBatch(client, gateway, undefined, fixedClock, defaultTuning, rest);
    expect(
      active
        ? calls.some((c) => c.method === 'DELETE' && c.url.includes('/scheduled-events/'))
        : calls.some((c) => c.method === 'PATCH' && JSON.stringify(c.body) === '{"status":4}')
    ).toBe(true);
    expect(
      scheduledStateSchema.parse(
        client.db.select().from(eventDiscordIntegrations).get()?.scheduledStateJson
      ).terminal
    ).toBe(true);
  }
);
