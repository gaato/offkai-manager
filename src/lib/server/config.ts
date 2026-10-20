import { z } from 'zod';
import { assertTimeZone } from '$lib/server/time';

const truthy = new Set(['true', '1', 'yes']);

const boolWithDefault = (fallback: boolean) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : truthy.has(String(value))),
    z.boolean()
  );

const intWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : Number(value)),
    z.number().int()
  );

function parseDuration(value: unknown, fallback: string, name: string): number {
  const raw = value === undefined || value === '' ? fallback : String(value);
  const part = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;
  const scale: Record<string, number> = {
    ns: 1 / 1_000_000,
    us: 1 / 1_000,
    µs: 1 / 1_000,
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000
  };
  let total = 0;
  let consumed = '';
  for (const match of raw.matchAll(part)) {
    consumed += match[0];
    total += Number(match[1]) * scale[match[2]];
  }
  if (!consumed || consumed !== raw || !Number.isFinite(total)) {
    throw new Error(`${name} must be a duration`);
  }
  return total;
}

const rawSchema = z.object({
  OFFKAI_HTTP_ADDR: z.string().default(':8080'),
  OFFKAI_HTTP_SHUTDOWN_TIMEOUT: z.string().optional(),
  OFFKAI_CLIENT_IP_HEADER: z.string().default(''),
  OFFKAI_TIMEZONE: z.string().default('Asia/Tokyo'),
  OFFKAI_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OFFKAI_DATABASE_URL: z.string().default(''),
  OFFKAI_DB_MAX_OPEN_CONNS: intWithDefault(10),
  OFFKAI_DB_MAX_IDLE_CONNS: intWithDefault(5),
  OFFKAI_DB_CONN_MAX_LIFETIME: z.string().optional(),
  OFFKAI_DB_MIGRATE: boolWithDefault(true),
  OFFKAI_PUBLIC_BASE_URL: z.string().default('http://127.0.0.1:8080'),
  OFFKAI_SESSION_SECRET: z.string().default(''),
  OFFKAI_AUTH_DEV_BYPASS: boolWithDefault(false),
  OFFKAI_DISCORD_CLIENT_ID: z.string().default(''),
  OFFKAI_DISCORD_CLIENT_SECRET: z.string().default(''),
  OFFKAI_DISCORD_REDIRECT_URL: z.string().default(''),
  OFFKAI_DISCORD_BOT_TOKEN: z.string().default(''),
  OFFKAI_STRIPE_SECRET_KEY: z.string().default(''),
  OFFKAI_STRIPE_WEBHOOK_SECRET: z.string().default(''),
  OFFKAI_PLATFORM_ADMIN_DISCORD_IDS: z.string().default(''),
  OFFKAI_WORKER_ENABLED: boolWithDefault(true)
});

export interface Config {
  http: {
    address: string;
    host: string;
    port: number;
    shutdownTimeoutMs: number;
    clientIpHeader: string;
  };
  time: { zone: string };
  log: { level: 'debug' | 'info' | 'warn' | 'error' };
  database: {
    url: string;
    maxOpenConnections: number;
    maxIdleConnections: number;
    connectionMaxLifetimeMs: number;
    migrate: boolean;
  };
  auth: {
    publicBaseUrl: string;
    sessionSecret: string;
    devBypass: boolean;
  };
  discord: {
    clientId: string;
    clientSecret: string;
    redirectUrl: string;
    botToken: string;
  };
  stripe: { secretKey: string; webhookSecret: string };
  platform: { adminDiscordIds: string[] };
  workerEnabled: boolean;
}

export function parseHttpAddress(address: string): { host: string; port: number } {
  const match = /^(.*):(\d+)$/.exec(address);
  if (!match) {
    throw new Error('OFFKAI_HTTP_ADDR must be in host:port form');
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('OFFKAI_HTTP_ADDR port must be between 1 and 65535');
  }
  return { host: match[1] || '0.0.0.0', port };
}

export function applyAdapterAddress(env: NodeJS.ProcessEnv): void {
  const { host, port } = parseHttpAddress(env.OFFKAI_HTTP_ADDR || ':8080');
  env.HOST = host;
  env.PORT = String(port);
  if (!env.ORIGIN) {
    // SvelteKit's built-in CSRF check needs the request origin; without it,
    // adapter-node rejects every form POST with 403 before our hooks run.
    try {
      env.ORIGIN = new URL(env.OFFKAI_PUBLIC_BASE_URL || 'http://127.0.0.1:8080').origin;
    } catch {
      // loadConfig reports the malformed URL with a proper error message.
    }
  }
  env.SHUTDOWN_TIMEOUT = String(
    Math.max(
      1,
      Math.ceil(
        parseDuration(env.OFFKAI_HTTP_SHUTDOWN_TIMEOUT, '10s', 'OFFKAI_HTTP_SHUTDOWN_TIMEOUT') /
          1_000
      )
    )
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid OFFKAI configuration: ${z.prettifyError(parsed.error)}`);
  }
  const raw = parsed.data;
  const address = parseHttpAddress(raw.OFFKAI_HTTP_ADDR);

  if (raw.OFFKAI_DB_MAX_OPEN_CONNS < 1) {
    throw new Error('OFFKAI_DB_MAX_OPEN_CONNS must be greater than zero');
  }
  if (raw.OFFKAI_DB_MAX_IDLE_CONNS < 0) {
    throw new Error('OFFKAI_DB_MAX_IDLE_CONNS must be zero or greater');
  }
  if (raw.OFFKAI_DB_MAX_IDLE_CONNS > raw.OFFKAI_DB_MAX_OPEN_CONNS) {
    throw new Error(
      'OFFKAI_DB_MAX_IDLE_CONNS must be less than or equal to OFFKAI_DB_MAX_OPEN_CONNS'
    );
  }

  let publicBaseUrl: URL;
  try {
    publicBaseUrl = new URL(raw.OFFKAI_PUBLIC_BASE_URL);
  } catch {
    throw new Error(
      'OFFKAI_PUBLIC_BASE_URL must be an absolute HTTP(S) origin without a path, query, or fragment'
    );
  }
  if (
    !['http:', 'https:'].includes(publicBaseUrl.protocol) ||
    publicBaseUrl.username ||
    publicBaseUrl.password ||
    !publicBaseUrl.host ||
    (publicBaseUrl.pathname !== '/' && publicBaseUrl.pathname !== '') ||
    publicBaseUrl.search ||
    publicBaseUrl.hash
  ) {
    throw new Error(
      'OFFKAI_PUBLIC_BASE_URL must be an absolute HTTP(S) origin without a path, query, or fragment'
    );
  }

  if (!raw.OFFKAI_AUTH_DEV_BYPASS && !raw.OFFKAI_DATABASE_URL) {
    throw new Error('OFFKAI_DATABASE_URL is required when OFFKAI_AUTH_DEV_BYPASS is not enabled');
  }
  if (!raw.OFFKAI_AUTH_DEV_BYPASS && !raw.OFFKAI_SESSION_SECRET) {
    throw new Error('OFFKAI_SESSION_SECRET is required when OFFKAI_AUTH_DEV_BYPASS is not enabled');
  }
  const discordOAuthValues = [
    raw.OFFKAI_DISCORD_CLIENT_ID,
    raw.OFFKAI_DISCORD_CLIENT_SECRET,
    raw.OFFKAI_DISCORD_REDIRECT_URL
  ];
  if (discordOAuthValues.some(Boolean) && !discordOAuthValues.every(Boolean)) {
    throw new Error(
      'OFFKAI_DISCORD_CLIENT_ID, OFFKAI_DISCORD_CLIENT_SECRET, and OFFKAI_DISCORD_REDIRECT_URL must be configured together'
    );
  }
  if (!raw.OFFKAI_AUTH_DEV_BYPASS && !discordOAuthValues.every(Boolean)) {
    throw new Error(
      'Discord OAuth configuration is required when OFFKAI_AUTH_DEV_BYPASS is not enabled'
    );
  }
  if (
    !raw.OFFKAI_AUTH_DEV_BYPASS &&
    Boolean(raw.OFFKAI_STRIPE_SECRET_KEY) !== Boolean(raw.OFFKAI_STRIPE_WEBHOOK_SECRET)
  ) {
    throw new Error(
      'OFFKAI_STRIPE_SECRET_KEY and OFFKAI_STRIPE_WEBHOOK_SECRET must be configured together'
    );
  }
  if (raw.OFFKAI_DISCORD_REDIRECT_URL) {
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(raw.OFFKAI_DISCORD_REDIRECT_URL);
    } catch {
      throw new Error('OFFKAI_DISCORD_REDIRECT_URL must be an absolute HTTP(S) URL');
    }
    if (
      !['http:', 'https:'].includes(redirectUrl.protocol) ||
      redirectUrl.username ||
      redirectUrl.password ||
      !redirectUrl.host ||
      redirectUrl.hash
    ) {
      throw new Error('OFFKAI_DISCORD_REDIRECT_URL must be an absolute HTTP(S) URL');
    }
  }
  const sessionSecret =
    raw.OFFKAI_SESSION_SECRET || (raw.OFFKAI_AUTH_DEV_BYPASS ? 'development-session-secret' : '');
  if (Buffer.byteLength(sessionSecret) < 16) {
    throw new Error('OFFKAI_SESSION_SECRET must be at least 16 bytes');
  }

  return {
    http: {
      address: raw.OFFKAI_HTTP_ADDR,
      host: address.host,
      port: address.port,
      shutdownTimeoutMs: parseDuration(
        raw.OFFKAI_HTTP_SHUTDOWN_TIMEOUT,
        '10s',
        'OFFKAI_HTTP_SHUTDOWN_TIMEOUT'
      ),
      clientIpHeader: raw.OFFKAI_CLIENT_IP_HEADER
    },
    time: { zone: assertTimeZone(raw.OFFKAI_TIMEZONE) },
    log: { level: raw.OFFKAI_LOG_LEVEL },
    database: {
      url: raw.OFFKAI_DATABASE_URL,
      maxOpenConnections: raw.OFFKAI_DB_MAX_OPEN_CONNS,
      maxIdleConnections: raw.OFFKAI_DB_MAX_IDLE_CONNS,
      connectionMaxLifetimeMs: parseDuration(
        raw.OFFKAI_DB_CONN_MAX_LIFETIME,
        '30m',
        'OFFKAI_DB_CONN_MAX_LIFETIME'
      ),
      migrate: raw.OFFKAI_DB_MIGRATE
    },
    auth: {
      publicBaseUrl: publicBaseUrl.origin,
      sessionSecret,
      devBypass: raw.OFFKAI_AUTH_DEV_BYPASS
    },
    discord: {
      clientId: raw.OFFKAI_DISCORD_CLIENT_ID,
      clientSecret: raw.OFFKAI_DISCORD_CLIENT_SECRET,
      redirectUrl: raw.OFFKAI_DISCORD_REDIRECT_URL,
      botToken: raw.OFFKAI_DISCORD_BOT_TOKEN
    },
    stripe: {
      secretKey: raw.OFFKAI_STRIPE_SECRET_KEY,
      webhookSecret: raw.OFFKAI_STRIPE_WEBHOOK_SECRET
    },
    platform: {
      adminDiscordIds: raw.OFFKAI_PLATFORM_ADMIN_DISCORD_IDS.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    },
    workerEnabled: raw.OFFKAI_WORKER_ENABLED
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
