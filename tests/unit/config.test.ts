import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAdapterAddress, loadConfig, parseHttpAddress } from '$lib/server/config';

const dev = {
  OFFKAI_AUTH_DEV_BYPASS: 'true'
};

describe('configuration', () => {
  it('permits the fake setup REST endpoint only on loopback with dev bypass', () => {
    expect(
      loadConfig({ ...dev, OFFKAI_DISCORD_SETUP_API_URL: 'http://127.0.0.1:12345/api/v10' }).discord
        .setupApiUrl
    ).toBe('http://127.0.0.1:12345/api/v10');
    for (const url of [
      'https://evil.example/api',
      'http://localhost:12345',
      'http://127.0.0.1.evil.example',
      'http://user:password@127.0.0.1:12345'
    ]) {
      expect(() => loadConfig({ ...dev, OFFKAI_DISCORD_SETUP_API_URL: url })).toThrow(/loopback/);
    }
    expect(() =>
      loadConfig({
        OFFKAI_DATABASE_PATH: ':memory:',
        OFFKAI_SESSION_SECRET: 'test-production-secret',
        OFFKAI_DISCORD_CLIENT_ID: 'test-client',
        OFFKAI_DISCORD_CLIENT_SECRET: 'test-secret',
        OFFKAI_DISCORD_REDIRECT_URL: 'https://example.test/auth/discord/callback',
        OFFKAI_DISCORD_SETUP_API_URL: 'http://127.0.0.1:12345'
      })
    ).toThrow(/dev bypass/);
  });
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
    expect(config.stripe.merchantMcc).toBe('7299');
    expect(loadConfig({ ...dev, OFFKAI_STRIPE_MERCHANT_MCC: '7999' }).stripe.merchantMcc).toBe(
      '7999'
    );
  });
  it.each([
    ['OFFKAI_STRIPE_MERCHANT_MCC', '729'],
    ['OFFKAI_STRIPE_MERCHANT_MCC', 'abcd'],
    ['OFFKAI_STRIPE_MERCHANT_MCC', ''],
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
  it.each([
    ['OFFKAI_DISCORD_PUBLIC_KEY', 'ab'.repeat(31)],
    ['OFFKAI_DISCORD_PUBLIC_KEY', 'gg'.repeat(32)],
    ['OFFKAI_DISCORD_APPLICATION_ID', 'not-a-snowflake'],
    ['OFFKAI_DISCORD_COMMAND_GUILD_ID', 'not-a-snowflake']
  ])('rejects invalid interaction configuration %s', (key, value) => {
    expect(() => loadConfig({ ...dev, [key]: value })).toThrow(/invalid OFFKAI configuration/);
  });
  it('requires Discord receiving credentials in production and accepts valid hex', () => {
    const production = {
      OFFKAI_DATABASE_PATH: ':memory:',
      OFFKAI_SESSION_SECRET: 'production-session-secret',
      OFFKAI_DISCORD_CLIENT_ID: 'oauth-client',
      OFFKAI_DISCORD_CLIENT_SECRET: 'oauth-secret',
      OFFKAI_DISCORD_REDIRECT_URL: 'https://example.test/auth/discord/callback'
    };
    const receiving = {
      OFFKAI_DISCORD_APPLICATION_ID: '100000000000000001',
      OFFKAI_DISCORD_PUBLIC_KEY: 'AB'.repeat(32),
      OFFKAI_DISCORD_BOT_TOKEN: 'fake-unit-token',
      OFFKAI_DISCORD_COMMAND_GUILD_ID: '400000000000000001'
    };
    for (const key of Object.keys(receiving).filter(
      (key) => key !== 'OFFKAI_DISCORD_COMMAND_GUILD_ID'
    )) {
      expect(() => loadConfig({ ...production, ...receiving, [key]: '' })).toThrow(
        /required in production/
      );
    }
    expect(loadConfig({ ...production, ...receiving }).discord).toMatchObject({
      applicationId: receiving.OFFKAI_DISCORD_APPLICATION_ID,
      publicKey: receiving.OFFKAI_DISCORD_PUBLIC_KEY,
      commandGuildId: receiving.OFFKAI_DISCORD_COMMAND_GUILD_ID
    });
  });
  it('maps the namespaced listen address over generic host defaults', () => {
    const env = { HOST: 'container-hostname', PORT: '3000' };
    applyAdapterAddress(env);
    expect(env).toMatchObject({ HOST: '0.0.0.0', PORT: '8080', SHUTDOWN_TIMEOUT: '10' });
  });
});

it('validates fee, rounding and hold bounds together', () => {
  const base = { OFFKAI_AUTH_DEV_BYPASS: 'true' };
  expect(loadConfig({ ...base, OFFKAI_PLATFORM_FEE_BPS: '0' }).tuning.OFFKAI_PLATFORM_FEE_BPS).toBe(
    0
  );
  for (const values of [
    { OFFKAI_PLATFORM_FEE_BPS: '9000', OFFKAI_STRIPE_FEE_BPS_ESTIMATE: '1000' },
    { OFFKAI_HOLD_MINUTES_MIN: '60', OFFKAI_HOLD_MINUTES_DEFAULT: '30' },
    { OFFKAI_HOLD_MINUTES_MAX: '30' },
    { OFFKAI_PRICE_ROUNDING_UNITS: '1,0' }
  ])
    expect(() => loadConfig({ ...base, ...values })).toThrow();
});

it('documents every application environment key declared in config.ts', () => {
  const source = readFileSync('src/lib/server/config.ts', 'utf8');
  const documentation = readFileSync('docs/configuration.md', 'utf8');
  const keys = [...new Set(source.match(/\bOFFKAI_[A-Z0-9_]+\b/g))].sort();
  expect(keys.length).toBeGreaterThan(0);
  const documented = new Set(documentation.match(/\bOFFKAI_[A-Z0-9_]+\b/g));
  expect(keys.filter((key) => !documented.has(key))).toEqual([]);
});
