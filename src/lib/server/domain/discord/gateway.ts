export interface DiscordGateway {
  getGuildResources?(guildId: string): Promise<import('./resources').GuildResources | null>;
  readonly enabled: boolean;
  isGuildMember(guildId: string, discordUserId: string): Promise<boolean>;
  addGuildMemberRole(guildId: string, discordUserId: string, roleId: string): Promise<void>;
  removeGuildMemberRole(guildId: string, discordUserId: string, roleId: string): Promise<void>;
  canManageGuild(guildId: string, discordUserId: string): Promise<boolean>;
  getGuildName(guildId: string): Promise<string>;
}
