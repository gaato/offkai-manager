/** Transport-neutral snapshots; permission integers stay decimal strings at boundaries. */
export interface GuildRole {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed: boolean;
}
export interface PermissionOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}
export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  permission_overwrites: PermissionOverwrite[];
}
export interface GuildResources {
  guildId: string;
  botId: string;
  botRoleIds: string[];
  roles: GuildRole[];
  channels: GuildChannel[];
}
export interface CreateChannel {
  name: string;
  type: 0 | 4;
  parent_id?: string;
  permission_overwrites: PermissionOverwrite[];
}
export interface DiscordSetupGateway {
  getGuildName(guildId: string): Promise<string>;
  canManageGuild(guildId: string, discordUserId: string): Promise<boolean>;
  /** null means the bot cannot access the guild; other failures must remain distinguishable. */
  getGuildResources(guildId: string): Promise<GuildResources | null>;
  createRole(guildId: string, name: string): Promise<{ id: string }>;
  createChannel(guildId: string, input: CreateChannel): Promise<{ id: string }>;
}
