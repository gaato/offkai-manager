import { describe, expect, it } from 'vitest';
import {
  createOAuthState,
  signSession,
  verifyOAuthState,
  verifySession
} from '$lib/server/auth/session';

const secret = 'unit-test-session-secret';

const now = new Date('2026-07-19T00:00:00Z');

describe('sessions', () => {
  it('round trips every session field', () => {
    const value = signSession(
      { userId: 'user-1', displayName: 'Test User', platformAdmin: true },
      secret,
      now
    );
    expect(verifySession(value, secret, now)).toMatchObject({
      userId: 'user-1',
      displayName: 'Test User',
      platformAdmin: true
    });
  });
  it('honors configured session and OAuth lifetimes', () => {
    const token = signSession(
      { userId: 'user-1', displayName: 'Test User', platformAdmin: false },
      secret,
      now,
      120
    );
    const oauth = createOAuthState('/app', secret, now, 60);
    expect(verifySession(token, secret, new Date(now.getTime() + 119_000))).not.toBeNull();
    expect(verifySession(token, secret, new Date(now.getTime() + 120_000))).toBeNull();
    expect(
      verifyOAuthState(oauth.cookieValue, oauth.state, secret, new Date(now.getTime() + 59_000))
    ).toBe('/app');
    expect(
      verifyOAuthState(oauth.cookieValue, oauth.state, secret, new Date(now.getTime() + 60_000))
    ).toBeNull();
  });
  it('rejects tampering and expiry', () => {
    const value = signSession(
      { userId: 'user-1', displayName: 'Test User', platformAdmin: false },
      secret,
      now
    );
    expect(verifySession(`${value}x`, secret, now)).toBeNull();
    expect(verifySession(value, secret, new Date('2026-07-21T00:00:00Z'))).toBeNull();
  });
  it('signs a short-lived OAuth state together with its return path', () => {
    const oauth = createOAuthState('/app?tab=team', secret, now);
    expect(verifyOAuthState(oauth.cookieValue, oauth.state, secret, now)).toBe('/app?tab=team');
    expect(verifyOAuthState(oauth.cookieValue, `${oauth.state}x`, secret, now)).toBeNull();
    expect(
      verifyOAuthState(oauth.cookieValue, oauth.state, secret, new Date('2026-07-19T00:11:00Z'))
    ).toBeNull();
  });
});
