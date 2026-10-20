import { z } from 'zod';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().transform((value) => value.toLowerCase())
});

const userResponseSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional()
});

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface DiscordIdentity {
  providerUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export class DiscordOAuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiscordOAuthError';
  }
}

export function discordAuthorizationUrl(config: DiscordOAuthConfig, state: string): string {
  ensureConfigured(config);
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUrl);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeDiscordCode(
  config: DiscordOAuthConfig,
  code: string,
  fetchImplementation: typeof fetch = fetch
): Promise<DiscordIdentity> {
  ensureConfigured(config);
  if (!code) throw new DiscordOAuthError('Discord authorization code is required');

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUrl
  });
  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImplementation(`${DISCORD_API_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenBody,
      signal: AbortSignal.timeout(10_000)
    });
  } catch (cause) {
    throw new DiscordOAuthError('Discord token exchange failed', { cause });
  }
  if (!tokenResponse.ok) {
    throw new DiscordOAuthError(`Discord token exchange returned ${tokenResponse.status}`);
  }

  const rawToken: unknown = await tokenResponse.json();
  const token = tokenResponseSchema.safeParse(rawToken);
  if (!token.success || token.data.token_type !== 'bearer') {
    throw new DiscordOAuthError('Discord token response was invalid');
  }

  let userResponse: Response;
  try {
    userResponse = await fetchImplementation(`${DISCORD_API_BASE_URL}/users/@me`, {
      headers: { Authorization: `Bearer ${token.data.access_token}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (cause) {
    throw new DiscordOAuthError('Discord user fetch failed', { cause });
  }
  if (!userResponse.ok) {
    throw new DiscordOAuthError(`Discord user fetch returned ${userResponse.status}`);
  }

  const rawUser: unknown = await userResponse.json();
  const user = userResponseSchema.safeParse(rawUser);
  if (!user.success) throw new DiscordOAuthError('Discord user response was invalid');

  const displayName = user.data.global_name?.trim() || user.data.username;
  const avatarUrl = user.data.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.data.id)}/${encodeURIComponent(user.data.avatar)}.png`
    : '';
  return {
    providerUserId: user.data.id,
    username: user.data.username,
    displayName,
    avatarUrl
  };
}

function ensureConfigured(config: DiscordOAuthConfig): void {
  if (!config.clientId || !config.clientSecret || !config.redirectUrl) {
    throw new DiscordOAuthError('Discord OAuth is not configured');
  }
}
