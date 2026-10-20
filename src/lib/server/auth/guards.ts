import { resolve } from '$app/paths';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { getConfig } from '$lib/server/config';
import { loginPath } from './login';
import { safeReturnTo } from './return-to';
import type { SessionData } from './session';

export function requireSession(
  event: Pick<RequestEvent, 'locals' | 'request' | 'url'>
): SessionData {
  if (event.locals.session) return event.locals.session;
  throw redirect(303, loginPath(getConfig(), authenticationReturnTo(event)));
}

export function requirePlatformAdmin(event: Pick<RequestEvent, 'locals'>): SessionData {
  const session = event.locals.session;
  if (!session?.platformAdmin) throw error(404);
  return session;
}

function authenticationReturnTo(event: Pick<RequestEvent, 'request' | 'url'>): string {
  if (event.request.method === 'GET' || event.request.method === 'HEAD') {
    return safeReturnTo(`${event.url.pathname}${event.url.search}`);
  }
  const referer = event.request.headers.get('referer');
  if (!referer) return resolve('/app');
  try {
    const parsed = new URL(referer);
    if (parsed.origin !== event.url.origin) return resolve('/app');
    return safeReturnTo(`${parsed.pathname}${parsed.search}`);
  } catch {
    return resolve('/app');
  }
}
