import { describe, expect, it } from 'vitest';
import { createApp } from '$lib/server/app';
import { loadConfig } from '$lib/server/config';

describe('application gateway composition', () => {
  it('uses the development gateway only with the explicit bypass and no key', () => {
    expect(createApp(loadConfig({ OFFKAI_AUTH_DEV_BYPASS: 'true' })).stripe.mode).toBe('dev');
  });

  it('prefers the real gateway when a Stripe key is configured', () => {
    const app = createApp(
      loadConfig({ OFFKAI_AUTH_DEV_BYPASS: 'true', OFFKAI_STRIPE_SECRET_KEY: 'sk_test_example' })
    );
    expect(app.stripe.mode).toBe('real');
  });

  it('disables Stripe when production configuration has no key', () => {
    const app = createApp(
      loadConfig({
        OFFKAI_DATABASE_URL: 'postgres://localhost/offkai',
        OFFKAI_SESSION_SECRET: 'production-session-secret',
        OFFKAI_DISCORD_CLIENT_ID: 'discord-client',
        OFFKAI_DISCORD_CLIENT_SECRET: 'discord-secret',
        OFFKAI_DISCORD_REDIRECT_URL: 'https://example.test/auth/discord/callback'
      })
    );
    expect(app.stripe).toEqual({ mode: 'disabled', connect: null, payment: null, webhook: null });
  });
});
