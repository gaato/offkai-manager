// @ts-expect-error SvelteKit exposes this runtime helper without module declarations.
import { with_request_store } from '@sveltejs/kit/internal/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../src/hooks.server';
import { resetConfigForTests } from '$lib/server/config';

function runHandle(event: ReturnType<typeof eventFor>, resolve: () => Promise<Response>) {
  const store = {
    event,
    state: { tracing: { record_span: ({ fn }: { fn: (span: unknown) => unknown }) => fn({}) } }
  };
  return with_request_store(store as unknown as Parameters<typeof with_request_store>[0], () =>
    handle({ event, resolve } as unknown as Parameters<typeof handle>[0])
  );
}

function eventFor(path: string) {
  const url = new URL(`https://example.test${path}?lang=ja`);
  return {
    url,
    request: new Request(url, {
      method: 'POST',
      body: '{}',
      headers: {
        origin: 'https://discord.com',
        'sec-fetch-site': 'cross-site',
        'accept-language': 'ja'
      }
    }),
    locals: {},
    getClientAddress: () => '127.0.0.1',
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }
  };
}
describe('interaction hook exemptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigForTests();
  });
  it.each(['/interactions', '/webhooks/stripe', '/webhooks/stripe/v2'])(
    'explicitly bypasses CSRF, cookies, session, and rate limiting for %s',
    async (path) => {
      vi.stubEnv('OFFKAI_AUTH_DEV_BYPASS', 'true');
      vi.stubEnv('OFFKAI_RATE_LIMIT_REQUESTS', '1');
      vi.stubEnv('OFFKAI_LOG_LEVEL', 'error');
      resetConfigForTests();
      const event = eventFor(path);
      const resolve = vi.fn(async () => new Response('ok'));
      for (let i = 0; i < 3; i++) {
        const response = await runHandle(event, resolve);
        expect(response.status).toBe(200);
        expect(response.headers.get('X-Request-Id')).toBeTruthy();
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      }
      expect(event.cookies.get).not.toHaveBeenCalled();
      expect(event.cookies.set).not.toHaveBeenCalled();
      expect(event.cookies.delete).not.toHaveBeenCalled();
      expect(event.locals).not.toHaveProperty('locale');
      expect(event.locals).not.toHaveProperty('session');
      expect(resolve).toHaveBeenCalledTimes(3);
    }
  );
  it.each([
    '/interactions/other',
    '/webhooks/stripe/other',
    '/webhooks/stripe/v2/other',
    '/auth/dev'
  ])('keeps browser CSRF protection on %s', async (path) => {
    vi.stubEnv('OFFKAI_AUTH_DEV_BYPASS', 'true');
    vi.stubEnv('OFFKAI_LOG_LEVEL', 'error');
    resetConfigForTests();
    const resolve = vi.fn(async () => new Response('ok'));
    await expect(runHandle(eventFor(path), resolve)).rejects.toMatchObject({ status: 403 });
    expect(resolve).not.toHaveBeenCalled();
  });
});
