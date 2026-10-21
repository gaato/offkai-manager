import { describe, expect, it } from 'vitest';
import { applyAdapterAddress, loadConfig, parseHttpAddress } from '$lib/server/config';

const dev = {
  OFFKAI_AUTH_DEV_BYPASS: 'true'
};

describe('configuration', () => {
  it('ports the legacy defaults and new flags', () => {
    const config = loadConfig(dev);
    expect(config.http).toMatchObject({
      address: ':8080',
      host: '0.0.0.0',
      port: 8080,
      shutdownTimeoutMs: 10000
    });
    expect(config.time.zone).toBe('Asia/Tokyo');
    expect(config.database).toMatchObject({
      path: '',
      migrate: true
    });
    expect(config.workerEnabled).toBe(true);
  });
  it.each([
    ['OFFKAI_OUTBOX_POLL_INTERVAL_MS', '0'],
    ['OFFKAI_OUTBOX_BATCH_SIZE', '1001'],
    ['OFFKAI_OUTBOX_MAX_ATTEMPTS', '1.5'],
    ['OFFKAI_RATE_LIMIT_REQUESTS', ''],
    ['OFFKAI_RATE_LIMIT_WINDOW_MS', 'Infinity'],
    ['OFFKAI_WEBHOOK_MAX_BODY_BYTES', '16777217'],
    ['OFFKAI_SESSION_TTL_SECONDS', '59'],
    ['OFFKAI_DB_BUSY_TIMEOUT_MS', '-1'],
    ['OFFKAI_PLATFORM_ACTIVITY_PAGE_SIZE', 'NaN']
  ])('rejects invalid %s at startup', (key, value) => {
    expect(() => loadConfig({ ...dev, [key]: value })).toThrow(/invalid OFFKAI configuration/);
  });
  it('requires durable production configuration', () => {
    expect(() => loadConfig({})).toThrow(/OFFKAI_DATABASE_PATH is required/);
    expect(() => loadConfig({ OFFKAI_DATABASE_PATH: '/tmp/offkai.sqlite' })).toThrow(
      /OFFKAI_SESSION_SECRET is required/
    );
    expect(() =>
      loadConfig({
        OFFKAI_DATABASE_PATH: '/tmp/offkai.sqlite',
        OFFKAI_SESSION_SECRET: 'production-session-secret'
      })
    ).toThrow(/Discord OAuth configuration is required/);
  });
  it('validates Discord OAuth configuration as one complete set', () => {
    expect(() => loadConfig({ ...dev, OFFKAI_DISCORD_CLIENT_ID: 'client-id' })).toThrow(
      /must be configured together/
    );
    expect(() =>
      loadConfig({
        ...dev,
        OFFKAI_DISCORD_CLIENT_ID: 'client-id',
        OFFKAI_DISCORD_CLIENT_SECRET: 'client-secret',
        OFFKAI_DISCORD_REDIRECT_URL: 'discord-callback'
      })
    ).toThrow(/absolute HTTP\(S\) URL/);
  });
  it('requires the Stripe key and webhook secret together in production', () => {
    const production = {
      OFFKAI_DATABASE_PATH: '/tmp/offkai.sqlite',
      OFFKAI_SESSION_SECRET: 'production-session-secret',
      OFFKAI_DISCORD_CLIENT_ID: 'discord-client',
      OFFKAI_DISCORD_CLIENT_SECRET: 'discord-secret',
      OFFKAI_DISCORD_REDIRECT_URL: 'https://example.test/auth/discord/callback'
    };
    expect(() =>
      loadConfig({ ...production, OFFKAI_STRIPE_SECRET_KEY: 'sk_live_example' })
    ).toThrow(/must be configured together/);
    expect(() =>
      loadConfig({ ...production, OFFKAI_STRIPE_WEBHOOK_SECRET: 'whsec_example' })
    ).toThrow(/must be configured together/);
  });
  it('validates database paths, origins, time zones, and addresses', () => {
    expect(() => loadConfig({ ...dev, OFFKAI_DATABASE_PATH: '\0bad' })).toThrow(/NUL/);
    expect(() =>
      loadConfig({ ...dev, OFFKAI_PUBLIC_BASE_URL: 'https://example.com/path' })
    ).toThrow(/absolute HTTP\(S\) origin/);
    expect(() => loadConfig({ ...dev, OFFKAI_TIMEZONE: 'not-a-zone' })).toThrow(/IANA/);
    expect(() => parseHttpAddress('localhost')).toThrow(/host:port/);
  });
  it('maps the namespaced listen address over generic host defaults', () => {
    const env = { HOST: 'container-hostname', PORT: '3000' };
    applyAdapterAddress(env);
    expect(env).toMatchObject({ HOST: '0.0.0.0', PORT: '8080', SHUTDOWN_TIMEOUT: '10' });
  });
});
