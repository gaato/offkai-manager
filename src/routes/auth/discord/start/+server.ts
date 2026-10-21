import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfig } from '$lib/server/config';
import { hasDiscordOAuthConfig, loginPath } from '$lib/server/auth/login';
import { safeReturnTo } from '$lib/server/auth/return-to';
import { createOAuthState, isSecureRequest, setOAuthStateCookie } from '$lib/server/auth/session';
import { discordAuthorizationUrl } from '$lib/server/gateways/discord/oauth';

export const GET: RequestHandler = (event) => {
  const config = getConfig();
  const returnTo = safeReturnTo(event.url.searchParams.get('return_to'));
  if (!hasDiscordOAuthConfig(config)) {
    if (config.auth.devBypass) throw redirect(302, loginPath(config, returnTo));
    throw error(503, event.locals.t('auth.unavailable'));
  }

  const oauthState = createOAuthState(
    returnTo,
    config.auth.sessionSecret,
    undefined,
    config.tuning.OFFKAI_OAUTH_STATE_TTL_SECONDS
  );
  setOAuthStateCookie(
    event.cookies,
    oauthState.cookieValue,
    isSecureRequest(event),
    config.tuning.OFFKAI_OAUTH_STATE_TTL_SECONDS
  );
  throw redirect(302, discordAuthorizationUrl(config.discord, oauthState.state));
};
