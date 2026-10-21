import { REST } from '@discordjs/rest';
import { defaultTuning, type Tuning } from '$lib/server/config';
import { z } from 'zod';
import type {
  CreateChannel,
  DiscordSetupGateway,
  GuildResources
} from '$lib/server/domain/discord/resources';
import {
  channelPermissions,
  hasPermissions,
  permissions
} from '$lib/server/domain/discord/permissions';
import type { DiscordGateway } from '$lib/server/domain/discord/gateway';

const discordApiBaseUrl = 'https://discord.com/api/v10';
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);
const guildSchema = z.object({
  id: snowflakeSchema,
  name: z.string(),
  owner_id: snowflakeSchema
});
const guildMemberSchema = z.object({ roles: z.array(snowflakeSchema) });
const guildRolesSchema = z.array(
  z.object({
    id: snowflakeSchema,
    permissions: z.string().regex(/^\d+$/)
  })
);
const resourceRolesSchema = z.array(
  z.object({
    id: snowflakeSchema,
    name: z.string(),
    position: z.number().int(),
    permissions: z.string().regex(/^\d+$/),
    managed: z.boolean()
  })
);
const resourceChannelsSchema = z.array(
  z.object({
    id: snowflakeSchema,
    name: z.string(),
    type: z.number().int(),
    parent_id: snowflakeSchema.nullable().optional(),
    permission_overwrites: z
      .array(
        z.object({
          id: snowflakeSchema,
          type: z.number().int(),
          allow: z.string().regex(/^\d+$/),
          deny: z.string().regex(/^\d+$/)
        })
      )
      .default([])
  })
);
const rateLimitSchema = z.object({ retry_after: z.number().nonnegative() });

const administratorPermission = 1n << 3n;
const manageGuildPermission = 1n << 5n;

export type DiscordGatewayErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_response'
  | 'request_failed'
  | 'unexpected_status';

export class DiscordGatewayError extends Error {
  constructor(
    readonly code: DiscordGatewayErrorCode,
    message: string,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'DiscordGatewayError';
  }
}

export class DiscordRateLimitError extends DiscordGatewayError {
  constructor(
    readonly retryAfterMs: number,
    operation: string
  ) {
    super('rate_limited', `${operation} was rate limited`, 429);
    this.name = 'DiscordRateLimitError';
  }
}

interface DiscordRestOptions {
  tuning?: Tuning;
  rest?: REST;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Minimal bot-token Discord REST client used by guild gates and role synchronization. */
export class DiscordRestGateway implements DiscordGateway, DiscordSetupGateway {
  readonly enabled = true;
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: string;
  private readonly tuning: Tuning;
  private readonly roleRest: REST | undefined;

  constructor(
    private readonly botToken: string,
    options: DiscordRestOptions = {}
  ) {
    if (!botToken.trim()) throw new Error('Discord bot token is required');
    this.fetchImplementation = options.fetch ?? fetch;
    this.roleRest =
      options.rest ??
      (options.fetch
        ? undefined
        : new REST({
            version: '10',
            rejectOnRateLimit: () => true,
            timeout: (options.tuning ?? defaultTuning).OFFKAI_DISCORD_REQUEST_TIMEOUT_MS
          }).setToken(botToken));
    this.tuning = options.tuning ?? defaultTuning;
    this.baseUrl = (options.baseUrl ?? discordApiBaseUrl).replace(/\/$/, '');
  }

  async isGuildMember(guildId: string, discordUserId: string): Promise<boolean> {
    const response = await this.request(
      'get guild member',
      'GET',
      this.memberPath(guildId, discordUserId)
    );
    if (response.status === 404) return false;
    if (response.status === 403) {
      throw new DiscordGatewayError('forbidden', 'Discord denied access to the guild member', 403);
    }
    await this.parseJson(response, guildMemberSchema, 'get guild member');
    return true;
  }

  async addGuildMemberRole(guildId: string, discordUserId: string, roleId: string): Promise<void> {
    if (this.roleRest) {
      await this.roleRest.put(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`);
      return;
    }
    const response = await this.request(
      'add guild member role',
      'PUT',
      `${this.memberPath(guildId, discordUserId)}/roles/${encodeURIComponent(roleId)}`
    );
    await this.expectNoContent(response, 'add guild member role');
  }

  async removeGuildMemberRole(
    guildId: string,
    discordUserId: string,
    roleId: string
  ): Promise<void> {
    if (this.roleRest) {
      await this.roleRest.delete(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`);
      return;
    }
    const response = await this.request(
      'remove guild member role',
      'DELETE',
      `${this.memberPath(guildId, discordUserId)}/roles/${encodeURIComponent(roleId)}`
    );
    if (response.status === 404) return;
    await this.expectNoContent(response, 'remove guild member role');
  }

  async canManageGuild(guildId: string, discordUserId: string): Promise<boolean> {
    const guildResponse = await this.request('get guild', 'GET', this.guildPath(guildId));
    if (guildResponse.status === 403 || guildResponse.status === 404) return false;
    const guild = await this.parseJson(guildResponse, guildSchema, 'get guild');
    if (guild.owner_id === discordUserId) return true;

    const memberResponse = await this.request(
      'get guild member',
      'GET',
      this.memberPath(guildId, discordUserId)
    );
    if (memberResponse.status === 403 || memberResponse.status === 404) return false;
    const member = await this.parseJson(memberResponse, guildMemberSchema, 'get guild member');

    const rolesResponse = await this.request(
      'get guild roles',
      'GET',
      `${this.guildPath(guildId)}/roles`
    );
    if (rolesResponse.status === 403 || rolesResponse.status === 404) return false;
    const roles = await this.parseJson(rolesResponse, guildRolesSchema, 'get guild roles');
    const heldRoleIds = new Set([...member.roles, guildId]);
    const permissions = roles.reduce(
      (combined, role) => combined | (heldRoleIds.has(role.id) ? BigInt(role.permissions) : 0n),
      0n
    );
    return (permissions & (administratorPermission | manageGuildPermission)) !== 0n;
  }

  async getGuildName(guildId: string): Promise<string> {
    const response = await this.request('get guild', 'GET', this.guildPath(guildId));
    if (response.status === 403) {
      throw new DiscordGatewayError('forbidden', 'Discord denied access to the guild', 403);
    }
    if (response.status === 404) {
      throw new DiscordGatewayError('not_found', 'Discord guild was not found', 404);
    }
    return (await this.parseJson(response, guildSchema, 'get guild')).name;
  }

  async getGuildResources(guildId: string): Promise<GuildResources | null> {
    const response = await this.request(
      'get guild roles',
      'GET',
      `${this.guildPath(guildId)}/roles`
    );
    if (response.status === 403 || response.status === 404) return null;
    const roles = await this.parseJson(response, resourceRolesSchema, 'get guild roles');
    const bot = await this.parseJson(
      await this.request('get bot user', 'GET', '/users/@me'),
      z.object({ id: snowflakeSchema }),
      'get bot user'
    );
    const memberResponse = await this.request(
      'get bot member',
      'GET',
      this.memberPath(guildId, bot.id)
    );
    if (memberResponse.status === 403 || memberResponse.status === 404) return null;
    const member = await this.parseJson(memberResponse, guildMemberSchema, 'get bot member');
    const channels = await this.parseJson(
      await this.request('get guild channels', 'GET', `${this.guildPath(guildId)}/channels`),
      resourceChannelsSchema,
      'get guild channels'
    );
    const resources = { guildId, botId: bot.id, botRoleIds: member.roles, roles, channels };
    return {
      ...resources,
      channels: channels.filter((channel) =>
        hasPermissions(
          channelPermissions(resources, channel.permission_overwrites),
          permissions.viewChannel
        )
      )
    };
  }

  async createRole(guildId: string, name: string): Promise<{ id: string }> {
    return this.parseJson(
      await this.request('create role', 'POST', `${this.guildPath(guildId)}/roles`, {
        name,
        permissions: '0',
        mentionable: false,
        hoist: false
      }),
      z.object({ id: snowflakeSchema }),
      'create role'
    );
  }

  async createChannel(guildId: string, input: CreateChannel): Promise<{ id: string }> {
    return this.parseJson(
      await this.request('create channel', 'POST', `${this.guildPath(guildId)}/channels`, input),
      z.object({ id: snowflakeSchema }),
      'create channel'
    );
  }

  private guildPath(guildId: string): string {
    return `/guilds/${encodeURIComponent(guildId)}`;
  }

  private memberPath(guildId: string, discordUserId: string): string {
    return `${this.guildPath(guildId)}/members/${encodeURIComponent(discordUserId)}`;
  }

  private async request(
    operation: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'X-Audit-Log-Reason': 'offkai-manager organizer setup',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        signal: AbortSignal.timeout(this.tuning.OFFKAI_DISCORD_REQUEST_TIMEOUT_MS)
      });
    } catch (cause) {
      throw new DiscordGatewayError('request_failed', `${operation} request failed`, undefined, {
        cause
      });
    }
    if (response.status === 429) {
      throw new DiscordRateLimitError(
        await retryAfterMs(response, this.tuning.OFFKAI_DISCORD_RETRY_AFTER_MS),
        operation
      );
    }
    return response;
  }

  private async parseJson<T>(
    response: Response,
    schema: z.ZodType<T>,
    operation: string
  ): Promise<T> {
    if (!response.ok) throw statusError(operation, response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new DiscordGatewayError(
        'invalid_response',
        `${operation} returned invalid JSON`,
        response.status,
        { cause }
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new DiscordGatewayError(
        'invalid_response',
        `${operation} returned an invalid response`,
        response.status,
        { cause: parsed.error }
      );
    }
    return parsed.data;
  }

  private async expectNoContent(response: Response, operation: string): Promise<void> {
    if (!response.ok) throw statusError(operation, response.status);
  }
}

export class DisabledDiscordGateway implements DiscordGateway, DiscordSetupGateway {
  readonly enabled = false;

  async isGuildMember(): Promise<boolean> {
    return true;
  }

  async addGuildMemberRole(): Promise<void> {}

  async removeGuildMemberRole(): Promise<void> {}

  async canManageGuild(): Promise<boolean> {
    return true;
  }

  async getGuildName(): Promise<string> {
    return '';
  }
  async getGuildResources(): Promise<null> {
    return null;
  }
  async createRole(): Promise<{ id: string }> {
    throw new DiscordGatewayError('forbidden', 'Discord bot is disabled');
  }
  async createChannel(): Promise<{ id: string }> {
    throw new DiscordGatewayError('forbidden', 'Discord bot is disabled');
  }
}

export function createDiscordGateway(
  botToken: string,
  options: DiscordRestOptions = {}
): DiscordGateway & DiscordSetupGateway {
  return botToken.trim() ? new DiscordRestGateway(botToken, options) : new DisabledDiscordGateway();
}

function statusError(operation: string, status: number): DiscordGatewayError {
  if (status === 403) {
    return new DiscordGatewayError('forbidden', `${operation} was forbidden`, status);
  }
  if (status === 404) {
    return new DiscordGatewayError('not_found', `${operation} was not found`, status);
  }
  return new DiscordGatewayError(
    'unexpected_status',
    `${operation} returned status ${status}`,
    status
  );
}

async function retryAfterMs(response: Response, fallbackMs: number): Promise<number> {
  const headerSeconds = Number(response.headers.get('Retry-After'));
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return headerSeconds * 1_000;
  try {
    const parsed = rateLimitSchema.safeParse(await response.json());
    if (parsed.success) return parsed.data.retry_after * 1_000;
  } catch {
    // Discord sometimes omits the JSON body; use a conservative retry delay.
  }
  return fallbackMs;
}
