import type { GuildResources, GuildRole, PermissionOverwrite } from './resources';

export const permissions = {
  administrator: 1n << 3n,
  manageChannels: 1n << 4n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  readMessageHistory: 1n << 16n,
  manageRoles: 1n << 28n,
  createPrivateThreads: 1n << 36n,
  sendMessagesInThreads: 1n << 38n
} as const;
export type PermissionName = keyof typeof permissions;
export const basePermissions =
  permissions.viewChannel |
  permissions.sendMessages |
  permissions.readMessageHistory |
  permissions.manageRoles |
  permissions.createPrivateThreads |
  permissions.sendMessagesInThreads;
export const layoutPermissions = permissions.manageChannels | permissions.manageRoles;

export function guildPermissions(
  guildId: string,
  roleIds: readonly string[],
  roles: readonly GuildRole[]
): bigint {
  return roles.reduce(
    (bits, role) =>
      bits | (role.id === guildId || roleIds.includes(role.id) ? BigInt(role.permissions) : 0n),
    0n
  );
}
export function hasPermissions(actual: bigint, required: bigint): boolean {
  return (actual & permissions.administrator) !== 0n || (actual & required) === required;
}
export function channelPermissions(
  resources: GuildResources,
  overwrites: readonly PermissionOverwrite[]
): bigint {
  const base = guildPermissions(resources.guildId, resources.botRoleIds, resources.roles);
  if (hasPermissions(base, permissions.administrator)) return base;
  const apply = (bits: bigint, values: readonly PermissionOverwrite[]) => {
    const deny = values.reduce((all, item) => all | BigInt(item.deny), 0n);
    const allow = values.reduce((all, item) => all | BigInt(item.allow), 0n);
    return (bits & ~deny) | allow;
  };
  const everyone = apply(
    base,
    overwrites.filter((item) => item.type === 0 && item.id === resources.guildId)
  );
  const roles = apply(
    everyone,
    overwrites.filter(
      (item) =>
        item.type === 0 && resources.botRoleIds.includes(item.id) && item.id !== resources.guildId
    )
  );
  return apply(
    roles,
    overwrites.filter((item) => item.type === 1 && item.id === resources.botId)
  );
}
export function roleAssignable(
  guildId: string,
  role: GuildRole,
  botRoleIds: readonly string[],
  roles: readonly GuildRole[]
): boolean {
  // Equal positions are treated conservatively, even if Discord's snowflake tie-break would allow it.
  const highest = Math.max(
    0,
    ...roles.filter((item) => botRoleIds.includes(item.id)).map((item) => item.position)
  );
  return role.id !== guildId && !role.managed && role.position < highest;
}
export function missingPermissions(actual: bigint, required: bigint): PermissionName[] {
  return hasPermissions(actual, required)
    ? []
    : (Object.keys(permissions) as PermissionName[]).filter(
        (name) =>
          (required & permissions[name]) !== 0n && !hasPermissions(actual, permissions[name])
      );
}
export function featurePermissions(
  resources: GuildResources,
  settings: { announcementChannelId?: string; roleId?: string; notificationChannelId?: string }
) {
  const guild = guildPermissions(resources.guildId, resources.botRoleIds, resources.roles);
  const inChannel = (id: string) => {
    const channel = resources.channels.find((item) => item.id === id);
    return channel ? channelPermissions(resources, channel.permission_overwrites) : 0n;
  };
  return {
    panel: settings.announcementChannelId
      ? missingPermissions(
          inChannel(settings.announcementChannelId),
          permissions.viewChannel | permissions.sendMessages
        )
      : [],
    roles: settings.roleId ? missingPermissions(guild, permissions.manageRoles) : [],
    notifications: settings.notificationChannelId
      ? missingPermissions(
          inChannel(settings.notificationChannelId),
          permissions.viewChannel |
            permissions.createPrivateThreads |
            permissions.sendMessagesInThreads
        )
      : [],
    layout: missingPermissions(guild, layoutPermissions)
  };
}
export function botAuthorizationUrl(
  clientId: string,
  guildId: string,
  required = basePermissions
): string {
  if (!clientId || !guildId) return '';
  const query = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: String(required),
    guild_id: guildId,
    disable_guild_select: 'true'
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

/** Selectable roles exclude roles Discord never permits a bot to assign, regardless of hierarchy. */
export function selectableRoles(guildId: string, roles: readonly GuildRole[]): GuildRole[] {
  return roles.filter((role) => role.id !== guildId && !role.managed);
}
