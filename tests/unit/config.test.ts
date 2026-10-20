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
      shutdownTimeoutMs: 10_000
    });
    expect(config.time.zone).toBe('Asia/Tokyo');
    expect(config.database).toMatchObject({
      maxOpenConnections: 10,
      maxIdleConnections: 5,
      connectionMaxLifetimeMs: 1_800_000,
      migrate: true
    });
    expect(config.workerEnabled).toBe(true);
  });

  it('requires durable production configuration', () => {
    expect(() => loadConfig({})).toThrow(/OFFKAI_DATABASE_URL is required/);
    expect(() => loadConfig({ OFFKAI_DATABASE_URL: 'postgres://localhost/offkai' })).toThrow(
      /OFFKAI_SESSION_SECRET is required/
    );
    expect(() =>
      loadConfig({
        OFFKAI_DATABASE_URL: 'postgres://localhost/offkai',
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
      OFFKAI_DATABASE_URL: 'postgres://localhost/offkai',
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

  it('validates pool bounds, origins, time zones, and addresses', () => {
    expect(() => loadConfig({ ...dev, OFFKAI_DB_MAX_IDLE_CONNS: '11' })).toThrow(
      /less than or equal/
    );
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
