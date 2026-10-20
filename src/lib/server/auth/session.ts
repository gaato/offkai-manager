import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

export const SESSION_COOKIE_NAME = 'offkai_session';
export const OAUTH_STATE_COOKIE_NAME = 'offkai_oauth_state';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface SessionData {
  userId: string;
  displayName: string;
  platformAdmin: boolean;
  issuedAt: number;
  expiresAt: number;
}

interface SessionPayload {
  user_id: string;
  display_name: string;
  platform_admin: boolean;
  iat: number;
  exp: number;
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signature(payload: string, secret: string, purpose: 'session' | 'oauth-state'): string {
  return createHmac('sha256', secret)
    .update(purpose)
    .update('\0')
    .update(payload)
    .digest('base64url');
}

function signedValue(payload: string, secret: string, purpose: 'session' | 'oauth-state'): string {
  return `${payload}.${signature(payload, secret, purpose)}`;
}

function verifiedPayload(
  value: string,
  secret: string,
  purpose: 'session' | 'oauth-state'
): string | null {
  const dot = value.indexOf('.');
  if (dot < 1 || dot === value.length - 1) return null;
  const payload = value.slice(0, dot);
  const supplied = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(payload, secret, purpose));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return payload;
}

export function signSession(
  input: Pick<SessionData, 'userId' | 'displayName' | 'platformAdmin'>,
  secret: string,
  now = new Date()
): string {
  if (secret.length < 16) throw new Error('session secret must be at least 16 bytes');
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    user_id: input.userId,
    display_name: input.displayName,
    platform_admin: input.platformAdmin,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS
  };
  const encoded = base64Url(JSON.stringify(payload));
  return signedValue(encoded, secret, 'session');
}

export function verifySession(value: string, secret: string, now = new Date()): SessionData | null {
  const payload = verifiedPayload(value, secret, 'session');
  if (!payload) return null;

  try {
    const raw = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as Partial<SessionPayload>;
    if (
      typeof raw.user_id !== 'string' ||
      !raw.user_id ||
      typeof raw.display_name !== 'string' ||
      !raw.display_name ||
      typeof raw.platform_admin !== 'boolean' ||
      typeof raw.iat !== 'number' ||
      typeof raw.exp !== 'number' ||
      raw.exp <= Math.floor(now.getTime() / 1000)
    ) {
      return null;
    }
    return {
      userId: raw.user_id,
      displayName: raw.display_name,
      platformAdmin: raw.platform_admin,
      issuedAt: raw.iat,
      expiresAt: raw.exp
    };
  } catch {
    return null;
  }
}

export interface OAuthState {
  state: string;
  cookieValue: string;
}

export function createOAuthState(returnTo: string, secret: string, now = new Date()): OAuthState {
  if (secret.length < 16) throw new Error('session secret must be at least 16 bytes');
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const state = randomBytes(32).toString('base64url');
  const payload = base64Url(
    JSON.stringify({
      state,
      return_to: returnTo,
      iat: issuedAt,
      exp: issuedAt + OAUTH_STATE_TTL_SECONDS
    })
  );
  return { state, cookieValue: signedValue(payload, secret, 'oauth-state') };
}

export function verifyOAuthState(
  value: string,
  expectedState: string,
  secret: string,
  now = new Date()
): string | null {
  const payload = verifiedPayload(value, secret, 'oauth-state');
  if (!payload || !expectedState) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<{
      state: string;
      return_to: string;
      iat: number;
      exp: number;
    }>;
    if (
      typeof raw.state !== 'string' ||
      typeof raw.return_to !== 'string' ||
      typeof raw.iat !== 'number' ||
      typeof raw.exp !== 'number' ||
      raw.exp <= Math.floor(now.getTime() / 1_000)
    ) {
      return null;
    }
    const supplied = Buffer.from(expectedState);
    const expected = Buffer.from(raw.state);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return raw.return_to;
  } catch {
    return null;
  }
}

export function isSecureRequest(event: Pick<RequestEvent, 'url' | 'request'>): boolean {
  return (
    event.url.protocol === 'https:' ||
    event.request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
  );
}

export function setSessionCookie(cookies: Cookies, value: string, secure: boolean): void {
  cookies.set(SESSION_COOKIE_NAME, value, {
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure
  });
}

export function clearSessionCookie(cookies: Pick<Cookies, 'delete'>, secure: boolean): void {
  cookies.delete(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure
  });
}

export function setOAuthStateCookie(cookies: Cookies, value: string, secure: boolean): void {
  cookies.set(OAUTH_STATE_COOKIE_NAME, value, {
    path: '/auth/discord',
    maxAge: OAUTH_STATE_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure
  });
}

export function clearOAuthStateCookie(cookies: Cookies, secure: boolean): void {
  cookies.delete(OAUTH_STATE_COOKIE_NAME, {
    path: '/auth/discord',
    httpOnly: true,
    sameSite: 'lax',
    secure
  });
}
