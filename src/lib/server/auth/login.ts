import type { Config } from '$lib/server/config';
import { safeReturnTo } from './return-to';

export function hasDiscordOAuthConfig(config: Config): boolean {
  return Boolean(
    config.discord.clientId && config.discord.clientSecret && config.discord.redirectUrl
  );
}

export function loginPath(config: Config, returnTo: string): string {
  const target = safeReturnTo(returnTo);
  const route =
    config.auth.devBypass && !hasDiscordOAuthConfig(config) ? '/auth/dev' : '/auth/discord/start';
  return `${route}?return_to=${encodeURIComponent(target)}`;
}
