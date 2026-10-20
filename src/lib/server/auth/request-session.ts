import type { Cookies } from '@sveltejs/kit';
import type { Config } from '$lib/server/config';
import {
  clearSessionCookie,
  isSecureRequest,
  SESSION_COOKIE_NAME,
  verifySession
} from '$lib/server/auth/session';
import { isSessionUserActive } from '$lib/server/auth/session-user';
import { getDatabaseClient, type DatabaseClient } from '$lib/server/db/client';

interface SessionRequest {
  cookies: Pick<Cookies, 'get' | 'delete'>;
  locals: Pick<App.Locals, 'session'>;
  request: Request;
  url: URL;
}

export async function populateRequestSession(
  event: SessionRequest,
  config: Config,
  client?: DatabaseClient
): Promise<void> {
  const raw = event.cookies.get(SESSION_COOKIE_NAME);
  const verified = raw ? verifySession(raw, config.auth.sessionSecret) : null;
  const active =
    verified && config.database.path
      ? await isSessionUserActive(
          client ?? getDatabaseClient(config),
          verified.userId,
          config.auth.devBypass
        )
      : Boolean(verified);
  event.locals.session = verified && active ? verified : null;
  if (raw && !event.locals.session) {
    clearSessionCookie(event.cookies, isSecureRequest(event));
  }
}
