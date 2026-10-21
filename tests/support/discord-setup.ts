import type { GuildResources, GuildRole, GuildChannel } from '$lib/server/domain/discord/resources';
import { basePermissions, layoutPermissions } from '$lib/server/domain/discord/permissions';

export const setupGuildId = '400000000000000001';
export const setupBotId = '400000000000000002';
export const setupBotRoleId = '400000000000000003';
export const highRoleId = '400000000000000004';
export function setupResources(): GuildResources {
  return {
    guildId: setupGuildId,
    botId: setupBotId,
    botRoleIds: [setupBotRoleId],
    roles: [
      { id: setupGuildId, name: '@everyone', position: 0, managed: false, permissions: '0' },
      {
        id: setupBotRoleId,
        name: 'Event Bot',
        position: 10,
        managed: true,
        permissions: String(basePermissions | layoutPermissions)
      },
      { id: highRoleId, name: 'Above the bot', position: 11, managed: false, permissions: '0' }
    ],
    channels: [
      {
        id: '400000000000000005',
        name: 'existing-announcements',
        type: 0,
        permission_overwrites: []
      }
    ]
  };
}
export function fakeDiscordFetch(resources = setupResources()) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  let sequence = 500000000000000000n;
  let creates = 0;
  const control = {
    failAt: 0,
    loseResponseAt: 0,
    unavailable: false,
    guildName: 'Setup Test Server',
    ownerId: '200000000000000001',
    resources,
    calls,
    beforeCreate: undefined as (() => Promise<void>) | undefined
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname.replace(/^\/api\/v10/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (control.unavailable) return Response.json({ code: 10004 }, { status: 404 });
    if (method === 'POST') {
      creates++;
      if (control.beforeCreate) await control.beforeCreate();
      if (creates === control.failAt) return Response.json({ code: 50013 }, { status: 403 });
      const id = String(++sequence);
      if (path.endsWith('/roles')) {
        resources.roles.push({ ...body, id, position: 1, managed: false } as GuildRole);
      } else if (path.endsWith('/channels')) {
        resources.channels.push({ ...body, id } as GuildChannel);
      } else return Response.json({}, { status: 404 });
      if (creates === control.loseResponseAt) throw new Error('simulated lost REST response');
      return Response.json({ id });
    }
    if (path === '/users/@me') return Response.json({ id: resources.botId });
    if (path.endsWith('/roles')) return Response.json(resources.roles);
    if (path.endsWith('/channels')) return Response.json(resources.channels);
    if (path.includes('/members/')) return Response.json({ roles: resources.botRoleIds });
    if (path === `/guilds/${resources.guildId}`)
      return Response.json({
        id: resources.guildId,
        name: control.guildName,
        owner_id: control.ownerId
      });
    return Response.json({}, { status: 404 });
  };
  return { ...control, fetch, control };
}
