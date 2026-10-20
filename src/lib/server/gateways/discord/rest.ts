import { z } from 'zod';
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
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Minimal bot-token Discord REST client used by guild gates and role synchronization. */
export class DiscordRestGateway implements DiscordGateway {
  readonly enabled = true;
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly botToken: string,
    options: DiscordRestOptions = {}
  ) {
    if (!botToken.trim()) throw new Error('Discord bot token is required');
    this.fetchImplementation = options.fetch ?? fetch;
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

  private guildPath(guildId: string): string {
    return `/guilds/${encodeURIComponent(guildId)}`;
  }

  private memberPath(guildId: string, discordUserId: string): string {
    return `${this.guildPath(guildId)}/members/${encodeURIComponent(discordUserId)}`;
  }

  private async request(operation: string, method: string, path: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'X-Audit-Log-Reason': 'offkai-manager role sync'
        },
        signal: AbortSignal.timeout(10_000)
      });
    } catch (cause) {
      throw new DiscordGatewayError('request_failed', `${operation} request failed`, undefined, {
        cause
      });
    }
    if (response.status === 429) {
      throw new DiscordRateLimitError(await retryAfterMs(response), operation);
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

export class DisabledDiscordGateway implements DiscordGateway {
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
}

export function createDiscordGateway(
  botToken: string,
  options: DiscordRestOptions = {}
): DiscordGateway {
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

async function retryAfterMs(response: Response): Promise<number> {
  const headerSeconds = Number(response.headers.get('Retry-After'));
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return headerSeconds * 1_000;
  try {
    const parsed = rateLimitSchema.safeParse(await response.json());
    if (parsed.success) return parsed.data.retry_after * 1_000;
  } catch {
    // Discord sometimes omits the JSON body; use a conservative retry delay.
  }
  return 1_000;
}
