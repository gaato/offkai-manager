import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { exchangeDiscordCode } from '$lib/server/gateways/discord/oauth';
import { safeReturnTo } from '$lib/server/auth/return-to';
import {
  clearOAuthStateCookie,
  isSecureRequest,
  OAUTH_STATE_COOKIE_NAME,
  setSessionCookie,
  signSession,
  verifyOAuthState
} from '$lib/server/auth/session';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
}

function localizedErrorResponse(
  event: Parameters<RequestHandler>[0],
  status: number,
  message: string
) {
  const escapedMessage = escapeHtml(message);
  return new Response(
    `<!doctype html><html lang="${event.locals.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedMessage}</title></head><body><main><p>${status}</p><h1>${escapedMessage}</h1></main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export const GET: RequestHandler = async (event) => {
  const config = getConfig();
  const secure = isSecureRequest(event);
  const stateCookie = event.cookies.get(OAUTH_STATE_COOKIE_NAME);
  clearOAuthStateCookie(event.cookies, secure);
  const returnTo = stateCookie
    ? verifyOAuthState(
        stateCookie,
        event.url.searchParams.get('state') ?? '',
        config.auth.sessionSecret
      )
    : null;
  if (!returnTo) {
    return localizedErrorResponse(event, 400, event.locals.t('auth.invalid_state'));
  }

  const code = event.url.searchParams.get('code');
  if (!code) return localizedErrorResponse(event, 400, event.locals.t('auth.missing_code'));
  try {
    const identity = await exchangeDiscordCode(
      config.discord,
      code,
      undefined,
      config.tuning.OFFKAI_DISCORD_REQUEST_TIMEOUT_MS
    );
    const user = await upsertDiscordIdentity(getDatabaseClient(config), identity);
    if (user.suspended) {
      return localizedErrorResponse(event, 403, event.locals.t('auth.suspended'));
    }
    setSessionCookie(
      event.cookies,
      signSession(
        {
          userId: user.userId,
          displayName: user.displayName,
          platformAdmin: config.platform.adminDiscordIds.includes(identity.providerUserId)
        },
        config.auth.sessionSecret,
        undefined,
        config.tuning.OFFKAI_SESSION_TTL_SECONDS
      ),
      secure,
      config.tuning.OFFKAI_SESSION_TTL_SECONDS
    );
  } catch (cause) {
    event.locals.logger.error({ err: cause }, 'discord oauth callback failed');
    return localizedErrorResponse(event, 502, event.locals.t('auth.failed'));
  }
  throw redirect(303, safeReturnTo(returnTo));
};
