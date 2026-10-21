import { randomBytes } from 'node:crypto';
import { sequence } from '@sveltejs/kit/hooks';
import { error, type Handle, type HandleServerError } from '@sveltejs/kit';
import { applyAdapterAddress, getConfig } from '$lib/server/config';
import { getLogger } from '$lib/server/logger';
import { SESSION_COOKIE_NAME, verifySession } from '$lib/server/auth/session';
import { populateRequestSession } from '$lib/server/auth/request-session';
import { getDatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import { getInteractionRest } from '$lib/server/interactions/rest';
import { systemClock } from '$lib/server/clock';
import { RoleSyncWorker } from '$lib/server/worker/role-sync';
import { normalizeLocale, resolveLocale, translator } from '$lib/i18n';

applyAdapterAddress();

const buckets = new Map<string, { count: number; startedAt: number }>();
let roleSyncWorker: RoleSyncWorker | undefined;
let workerShutdownInstalled = false;

export async function init(): Promise<void> {
  const config = getConfig();
  const logger = getLogger(config);

  if (config.auth.devBypass) {
    logger.warn(
      'AUTH DEV BYPASS ENABLED: anyone who can reach /auth/dev can mint arbitrary sessions, including platform admin'
    );
  }
  if (config.database.path && config.database.migrate) {
    await runMigrations(getDatabaseClient(config));
    logger.info('database migrations applied');
  }
  if (config.workerEnabled) {
    if (!config.database.path || !config.discord.botToken) {
      logger.warn(
        'Discord role sync worker is disabled because database or bot-token configuration is incomplete'
      );
    } else if (!roleSyncWorker) {
      const discordRest = getInteractionRest(
        config.discord.botToken,
        config.tuning.OFFKAI_DISCORD_REQUEST_TIMEOUT_MS
      );
      roleSyncWorker = new RoleSyncWorker(
        getDatabaseClient(config),
        createDiscordGateway(config.discord.botToken, { tuning: config.tuning, rest: discordRest }),
        logger,
        config.tuning,
        systemClock,
        discordRest,
        config.time.zone
      );
      roleSyncWorker.start();
      logger.info('Discord role sync worker started');
      if (!workerShutdownInstalled) {
        workerShutdownInstalled = true;
        process.once('SIGTERM', async () => {
          await roleSyncWorker?.stop();
          logger.info('Discord role sync worker stopped');
        });
      }
    }
  }
}

const requestLog: Handle = async ({ event, resolve }) => {
  const startedAt = performance.now();
  const requestId = randomBytes(8).toString('hex');
  const logger = getLogger(getConfig()).child({ request_id: requestId });
  event.locals.requestId = requestId;
  event.locals.logger = logger;

  let response: Response;
  try {
    response = await resolve(event);
  } catch (cause) {
    logger.error(
      {
        err: cause,
        method: event.request.method,
        path: event.url.pathname,
        duration_ms: performance.now() - startedAt
      },
      'http request failed'
    );
    throw cause;
  }
  response.headers.set('X-Request-Id', requestId);
  logger[response.status >= 500 ? 'error' : 'info'](
    {
      method: event.request.method,
      path: event.url.pathname,
      status: response.status,
      duration_ms: performance.now() - startedAt
    },
    'http request'
  );
  return response;
};

const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  return response;
};

// Discord authenticates the raw body with Ed25519 rather than browser cookies.
const isStripeWebhook = (path: string): boolean =>
  path === '/webhooks/stripe' || path === '/webhooks/stripe/v2';
const isInteraction = (path: string): boolean => path === '/interactions';

const rejectCrossSite: Handle = async ({ event, resolve }) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method) &&
    !isStripeWebhook(event.url.pathname) &&
    !isInteraction(event.url.pathname)
  ) {
    if (event.request.headers.get('sec-fetch-site') === 'cross-site') {
      throw error(403, 'cross-site request rejected');
    }
    const origin = event.request.headers.get('origin');
    const expected = new URL(getConfig().auth.publicBaseUrl).origin;
    if (origin && origin !== 'null' && origin !== expected) {
      throw error(403, 'cross-site request rejected');
    }
  }
  return resolve(event);
};

function clientIpKey(event: Parameters<Handle>[0]['event']): string {
  const config = getConfig();
  const configuredHeader = config.http.clientIpHeader;
  const address = configuredHeader
    ? event.request.headers.get(configuredHeader)?.trim() || 'unknown'
    : event.getClientAddress();
  return `ip:${address}`;
}

function rateLimitKey(event: Parameters<Handle>[0]['event']): string {
  const config = getConfig();
  const rawSession = event.cookies.get(SESSION_COOKIE_NAME);
  if (rawSession) {
    const session = verifySession(rawSession, config.auth.sessionSecret);
    if (session) return `u:${session.userId}`;
  }
  return clientIpKey(event);
}

function limitedResponse(message: string, bucket: { startedAt: number }, now: number): Response {
  return new Response(message, {
    status: 429,
    headers: {
      'Retry-After': String(
        Math.ceil(
          (getConfig().tuning.OFFKAI_RATE_LIMIT_WINDOW_MS - (now - bucket.startedAt)) / 1_000
        )
      )
    }
  });
}

function takeRateLimit(
  store: Map<string, { count: number; startedAt: number }>,
  key: string,
  limit: number,
  now: number
): { allowed: true } | { allowed: false; bucket: { count: number; startedAt: number } } {
  const current = store.get(key);
  if (!current || now - current.startedAt >= getConfig().tuning.OFFKAI_RATE_LIMIT_WINDOW_MS) {
    if (store.size >= getConfig().tuning.OFFKAI_RATE_LIMIT_CLEANUP_THRESHOLD) {
      for (const [staleKey, bucket] of store) {
        if (now - bucket.startedAt >= getConfig().tuning.OFFKAI_RATE_LIMIT_WINDOW_MS)
          store.delete(staleKey);
      }
    }
    store.set(key, { count: 1, startedAt: now });
    return { allowed: true };
  }
  if (current.count >= limit) return { allowed: false, bucket: current };
  current.count += 1;
  return { allowed: true };
}

const rateLimit: Handle = async ({ event, resolve }) => {
  if (isInteraction(event.url.pathname) || isStripeWebhook(event.url.pathname))
    return resolve(event);
  const limited =
    event.request.method === 'POST' &&
    ['/auth/'].some((prefix) => event.url.pathname.startsWith(prefix));
  if (!limited) return resolve(event);

  const now = Date.now();
  const generalLimit = takeRateLimit(
    buckets,
    rateLimitKey(event),
    getConfig().tuning.OFFKAI_RATE_LIMIT_REQUESTS,
    now
  );
  if (!generalLimit.allowed) {
    return limitedResponse('too many requests', generalLimit.bucket, now);
  }
  return resolve(event);
};

const locale: Handle = async ({ event, resolve }) => {
  if (isInteraction(event.url.pathname) || isStripeWebhook(event.url.pathname))
    return resolve(event);
  const queryLocale = normalizeLocale(event.url.searchParams.get('lang'));
  const selected = resolveLocale(
    event.url.searchParams.get('lang'),
    event.cookies.get('offkai_lang'),
    event.request.headers.get('accept-language')
  );
  if (queryLocale) {
    event.cookies.set('offkai_lang', selected, {
      path: '/',
      maxAge: getConfig().tuning.OFFKAI_LOCALE_COOKIE_TTL_SECONDS,
      httpOnly: false,
      sameSite: 'lax',
      secure:
        event.url.protocol === 'https:' ||
        event.request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
    });
  }
  event.locals.locale = selected;
  event.locals.t = translator(selected);
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', selected)
  });
};

const session: Handle = async ({ event, resolve }) => {
  if (isInteraction(event.url.pathname) || isStripeWebhook(event.url.pathname))
    return resolve(event);
  const config = getConfig();
  await populateRequestSession(event, config);
  return resolve(event);
};

export const handle = sequence(
  requestLog,
  securityHeaders,
  locale,
  rejectCrossSite,
  rateLimit,
  session
);

export const handleError: HandleServerError = ({ error: cause, event, status }) => {
  const requestId = event.locals.requestId ?? randomBytes(8).toString('hex');
  event.locals.logger?.error(
    { err: cause, status, method: event.request.method, path: event.url.pathname },
    'request error'
  );
  return { message: 'request failed', requestId };
};
