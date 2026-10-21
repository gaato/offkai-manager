import { describe, expect, it } from 'vitest';
import {
  permissions as p,
  basePermissions,
  layoutPermissions,
  guildPermissions,
  channelPermissions,
  hasPermissions,
  roleAssignable,
  featurePermissions,
  botAuthorizationUrl
} from '$lib/server/domain/discord/permissions';
import {
  recommendedLayout,
  planLayout,
  layoutChannelInput
} from '$lib/server/domain/discord/layout';
import { renderPanelTemplate, truncatePanelBody } from '$lib/server/interactions/panel-template';
import { unknownPanelVariables } from '$lib/shared/panel-template';
import { commandDefinitions } from '$lib/server/interactions/commands';
import { preparationChecklist } from '$lib/server/domain/events/dashboard';
import { DiscordRestGateway } from '$lib/server/gateways/discord/rest';
import {
  fakeDiscordFetch,
  setupResources,
  setupGuildId,
  setupBotRoleId
} from '../support/discord-setup';

const values = {
  title: '*Title* @everyone <@123> {venue}',
  date: 'date',
  start: 'start',
  end: 'end',
  venue: 'Venue',
  fee: '',
  capacity: '10',
  deadline: 'deadline'
};
describe('Discord preparation pure functions', () => {
  it('filters invisible REST channels and distinguishes uninstalled bots from transient failures', async () => {
    const fake = fakeDiscordFetch();
    fake.control.resources.channels.push({
      id: '400000000000000008',
      name: 'hidden',
      type: 0,
      permission_overwrites: [
        { id: fake.control.resources.botId, type: 1, allow: '0', deny: String(p.viewChannel) }
      ]
    });
    const gateway = new DiscordRestGateway('fake-token', { fetch: fake.fetch });
    expect(
      (await gateway.getGuildResources(setupGuildId))!.channels.map((channel) => channel.name)
    ).toEqual(['existing-announcements']);
    fake.control.unavailable = true;
    expect(await gateway.getGuildResources(setupGuildId)).toBeNull();
    const offline = new DiscordRestGateway('fake-token', {
      fetch: async () => {
        throw new Error('offline');
      }
    });
    await expect(offline.getGuildResources(setupGuildId)).rejects.toMatchObject({
      code: 'request_failed'
    });
  });
  it('combines everyone and held roles with bigint permissions and Administrator bypass', () => {
    const resources = setupResources();
    resources.roles[0].permissions = String(p.sendMessagesInThreads);
    expect(guildPermissions(setupGuildId, [], resources.roles)).toBe(p.sendMessagesInThreads);
    expect(guildPermissions(setupGuildId, [setupBotRoleId], resources.roles)).toBe(
      basePermissions | layoutPermissions
    );
    expect(hasPermissions(p.administrator, basePermissions | layoutPermissions)).toBe(true);
  });
  it('applies everyone, combined role, then member overwrites; allow wins within role overwrites', () => {
    const resources = setupResources();
    resources.botRoleIds.push('400000000000000009');
    const overwrites = [
      { id: setupGuildId, type: 0, allow: '0', deny: String(p.sendMessages) },
      { id: setupBotRoleId, type: 0, allow: String(p.sendMessages), deny: '0' },
      { id: '400000000000000009', type: 0, allow: '0', deny: String(p.sendMessages) }
    ];
    expect(hasPermissions(channelPermissions(resources, overwrites), p.sendMessages)).toBe(true);
    expect(
      hasPermissions(
        channelPermissions(resources, [
          ...overwrites,
          { id: resources.botId, type: 1, allow: '0', deny: String(p.sendMessages) }
        ]),
        p.sendMessages
      )
    ).toBe(false);
    resources.roles[1].permissions = String(p.administrator);
    expect(hasPermissions(channelPermissions(resources, overwrites), basePermissions)).toBe(true);
  });
  it('rejects managed/everyone/equal/higher roles even with Administrator', () => {
    const resources = setupResources();
    const role = { ...resources.roles[2], position: 9 };
    const assignable = (value = role) =>
      roleAssignable(resources.guildId, value, resources.botRoleIds, resources.roles);
    expect(assignable()).toBe(true);
    expect(assignable({ ...role, position: 10 })).toBe(false);
    expect(assignable({ ...role, position: 11 })).toBe(false);
    expect(assignable({ ...role, managed: true })).toBe(false);
    expect(assignable({ ...role, id: resources.guildId })).toBe(false);
    expect(roleAssignable(resources.guildId, role, [], resources.roles)).toBe(false);
  });
  it('reports channel restrictions and missing high-bit thread permissions per enabled feature', () => {
    const resources = setupResources();
    resources.roles[1].permissions = String(p.viewChannel | p.sendMessages);
    resources.channels[0].permission_overwrites = [
      { id: resources.botId, type: 1, allow: '0', deny: String(p.sendMessages) }
    ];
    const missing = featurePermissions(resources, {
      announcementChannelId: resources.channels[0].id,
      roleId: 'chosen',
      notificationChannelId: resources.channels[0].id
    });
    expect(missing.panel).toEqual(['sendMessages']);
    expect(missing.roles).toEqual(['manageRoles']);
    expect(missing.notifications).toEqual(['createPrivateThreads', 'sendMessagesInThreads']);
    expect(missing.layout).toEqual(['manageChannels', 'manageRoles']);
    expect(featurePermissions(resources, {}).notifications).toEqual([]);
    const url = new URL(botAuthorizationUrl('123', resources.guildId));
    expect(url.searchParams.get('permissions')).toBe(String(basePermissions));
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('disable_guild_select')).toBe('true');
    expect(basePermissions & p.administrator).toBe(0n);
  });
  it('plans creates only and is empty from the post-apply state', () => {
    const steps = planLayout(recommendedLayout, []);
    expect(steps).toEqual(recommendedLayout);
    const existing = steps.map((step, index) => ({ kind: step.kind, discordId: String(index) }));
    expect(planLayout(recommendedLayout, existing)).toEqual([]);
    expect(planLayout(recommendedLayout, existing.slice(0, 3))).toEqual(steps.slice(3));
    expect(steps.every((step) => ['role', 'category', 'channel'].includes(step.type))).toBe(true);
  });
  it('creates private staff/log and read-only panel overwrites without elevated roles', () => {
    const resources = setupResources();
    const ids = { participant: 'p', paid: 'paid', staff: 's', category: 'c' };
    const staff = layoutChannelInput(recommendedLayout[7], resources.guildId, resources.botId, ids);
    expect(staff.permission_overwrites.find((o) => o.id === 'p')).toBeUndefined();
    expect(staff.permission_overwrites.find((o) => o.id === resources.guildId)?.deny).toBe(
      String(p.viewChannel)
    );
    const panel = layoutChannelInput(recommendedLayout[4], resources.guildId, resources.botId, ids);
    expect(
      BigInt(panel.permission_overwrites.find((o) => o.id === 'p')!.deny) & p.sendMessages
    ).toBe(p.sendMessages);
  });
  it('renders only allowed variables once, escapes values/mentions, and validates unknown variables', () => {
    const text = renderPanelTemplate('**{title}** {fee} {venue} {unknown}', values);
    expect(text).toContain('\\*Title\\*');
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('<@123>');
    expect(text).toContain('{venue}');
    expect(text).toContain('{unknown}');
    expect(unknownPanelVariables('{title} {fee} {unknown} {bad-name}')).toEqual([
      'unknown',
      'bad-name'
    ]);
    const shortened = truncatePanelBody('🦉'.repeat(5000), 100, 'Full rules from organizer');
    expect(shortened.length).toBeLessThanOrEqual(100);
    expect(shortened.endsWith('…\n\nFull rules from organizer')).toBe(true);
  });
  it('localizes all slash option names and descriptions in Japanese', () => {
    const [offkai, checkin] = commandDefinitions();
    const panel = offkai.options!.find((option) => option.name === 'panel');
    if (!panel || !('options' in panel)) throw new Error('panel options missing');
    expect(panel.options!.map((option) => option.name_localizations?.ja)).toEqual([
      'イベント',
      '言語'
    ]);
    expect(panel.options!.every((option) => option.description_localizations?.ja)).toBe(true);
    expect(checkin.options![0].name_localizations?.ja).toBeTruthy();
    expect(checkin.options![0].description_localizations?.ja).toBeTruthy();
  });
  it('keeps preparation steps actionable until reviewed and posted', () => {
    expect(
      preparationChecklist({ guildId: '', reviewed: false, panelPosted: false }).map(
        (step) => step.done
      )
    ).toEqual([false, false, false]);
    expect(
      preparationChecklist({ guildId: 'guild', reviewed: true, panelPosted: true }).every(
        (step) => step.done
      )
    ).toBe(true);
  });
});
