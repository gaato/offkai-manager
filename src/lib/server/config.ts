import { z } from 'zod';
import { assertTimeZone } from '$lib/server/time';

const truthy = new Set(['true', '1', 'yes']);

const boolWithDefault = (fallback: boolean) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : truthy.has(String(value))),
    z.boolean()
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

const positiveInteger = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? NaN : value),
    z.coerce.number().int().min(min).max(max).default(fallback)
  );

export const tuningSchema = z.object({
  OFFKAI_PLATFORM_FEE_BPS: positiveInteger(0, 0, 9000),
  OFFKAI_STRIPE_FEE_BPS_ESTIMATE: positiveInteger(360, 0, 9000),
  OFFKAI_HOLD_MINUTES_DEFAULT: positiveInteger(30, 1, 1440),
  OFFKAI_HOLD_MINUTES_MIN: positiveInteger(30, 1, 1440),
  OFFKAI_HOLD_MINUTES_MAX: positiveInteger(1440, 31, 1440),
  OFFKAI_HOLD_TICK_INTERVAL_MS: positiveInteger(15000, 100, 3600000),
  OFFKAI_HOLD_EXPIRING_SOON_MINUTES: positiveInteger(5, 1, 1440),
  OFFKAI_PAYMENT_REMINDER_LEAD_HOURS: positiveInteger(72, 1, 8760),
  OFFKAI_NOTIFICATION_DM_INTERVAL_MS: positiveInteger(1000, 0, 60000),
  OFFKAI_NOTIFICATION_ARCHIVE_DAYS: positiveInteger(7, 0, 365),
  OFFKAI_RATE_LIMIT_WINDOW_MS: positiveInteger(60_000, 1_000, 3_600_000),
  OFFKAI_RATE_LIMIT_REQUESTS: positiveInteger(60, 1, 10_000),
  OFFKAI_RATE_LIMIT_CLEANUP_THRESHOLD: positiveInteger(10_000, 100, 1_000_000),
  OFFKAI_WEBHOOK_MAX_BODY_BYTES: positiveInteger(1_048_576, 1_024, 16_777_216),
  OFFKAI_OUTBOX_POLL_INTERVAL_MS: positiveInteger(15_000, 100, 3_600_000),
  OFFKAI_OUTBOX_BATCH_SIZE: positiveInteger(10, 1, 1_000),
  OFFKAI_OUTBOX_MAX_ATTEMPTS: positiveInteger(5, 1, 100),
  OFFKAI_DISCORD_REQUEST_TIMEOUT_MS: positiveInteger(10_000, 100, 120_000),
  OFFKAI_DISCORD_RETRY_AFTER_MS: positiveInteger(1_000, 1, 3_600_000),
  OFFKAI_INTERACTION_DRAFT_TTL_SECONDS: positiveInteger(3_600, 60, 86_400),
  OFFKAI_SESSION_TTL_SECONDS: positiveInteger(86_400, 60, 2_592_000),
  OFFKAI_OAUTH_STATE_TTL_SECONDS: positiveInteger(600, 60, 3_600),
  OFFKAI_LOCALE_COOKIE_TTL_SECONDS: positiveInteger(31_536_000, 60, 31_536_000),
  OFFKAI_EVENT_DEFAULT_DURATION_MS: positiveInteger(10_800_000, 60_000, 604_800_000),
  OFFKAI_ACTIVITY_LIMIT: positiveInteger(100, 1, 1_000),
  OFFKAI_PARTICIPANT_LIST_LIMIT: positiveInteger(500, 1, 10_000),
  OFFKAI_PLATFORM_ACTIVITY_PAGE_SIZE: positiveInteger(50, 1, 1_000),
  OFFKAI_PLATFORM_DETAIL_AUDIT_LIMIT: positiveInteger(20, 1, 1_000),
  OFFKAI_PLATFORM_USER_SEARCH_LIMIT: positiveInteger(50, 1, 1_000),
  OFFKAI_PLATFORM_RECENT_AUDIT_LIMIT: positiveInteger(12, 1, 1_000),
  OFFKAI_DB_BUSY_TIMEOUT_MS: positiveInteger(5_000, 0, 60_000)
});

// Pure defaults keep isolated callers usable without reading the process environment.
export const defaultTuning = tuningSchema.parse({});
export type Tuning = z.infer<typeof tuningSchema>;

const rawSchema = z.object({
  ...tuningSchema.shape,
  OFFKAI_HTTP_ADDR: z.string().default(':8080'),
  OFFKAI_HTTP_SHUTDOWN_TIMEOUT: z.string().optional(),
  OFFKAI_CLIENT_IP_HEADER: z.string().default(''),
  OFFKAI_TIMEZONE: z.string().default('Asia/Tokyo'),
  OFFKAI_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OFFKAI_DATABASE_PATH: z
    .string()
    .trim()
    .refine((path) => !path.includes('\0'), 'database path must not contain NUL')
    .default(''),
  OFFKAI_DB_MIGRATE: boolWithDefault(true),
  OFFKAI_PUBLIC_BASE_URL: z.string().default('http://127.0.0.1:8080'),
  OFFKAI_SESSION_SECRET: z.string().default(''),
  OFFKAI_AUTH_DEV_BYPASS: boolWithDefault(false),
  OFFKAI_DISCORD_CLIENT_ID: z.string().default(''),
  OFFKAI_DISCORD_CLIENT_SECRET: z.string().default(''),
  OFFKAI_DISCORD_REDIRECT_URL: z.string().default(''),
  OFFKAI_DISCORD_BOT_TOKEN: z.string().default(''),
  OFFKAI_DISCORD_SETUP_API_URL: z.url().default('https://discord.com/api/v10'),
  OFFKAI_DISCORD_APPLICATION_ID: z
    .string()
    .regex(/^\d{17,20}$/)
    .or(z.literal(''))
    .default(''),
  OFFKAI_DISCORD_PUBLIC_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .or(z.literal(''))
    .default(''),
  OFFKAI_DISCORD_COMMAND_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/)
    .or(z.literal(''))
    .default(''),
  OFFKAI_STRIPE_SECRET_KEY: z.string().default(''),
  OFFKAI_STRIPE_WEBHOOK_SECRET: z.string().default(''),
  OFFKAI_STRIPE_V2_WEBHOOK_SECRET: z.string().default(''),
  OFFKAI_STRIPE_PUBLISHABLE_KEY: z.string().default(''),
  OFFKAI_STRIPE_MERCHANT_MCC: z
    .string()
    .regex(/^\d{4}$/)
    .default('7299'),
  OFFKAI_PRICE_ROUNDING_UNITS: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .default('1,10,100'),
  OFFKAI_PLATFORM_ADMIN_DISCORD_IDS: z.string().default(''),
  OFFKAI_WORKER_ENABLED: boolWithDefault(true)
});

export interface Config {
  tuning: Tuning;
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
    path: string;
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
    setupApiUrl: string;
    applicationId: string;
    publicKey: string;
    commandGuildId: string;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
    v2WebhookSecret: string;
    publishableKey: string;
    merchantMcc: string;
  };
  priceRoundingUnits: number[];
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

export function applyAdapterAddress(env: NodeJS.ProcessEnv = process.env): void {
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
  if (raw.OFFKAI_PLATFORM_FEE_BPS + raw.OFFKAI_STRIPE_FEE_BPS_ESTIMATE >= 10000)
    throw new Error('combined fee rates must be less than 10000 bps');
  if (
    raw.OFFKAI_HOLD_MINUTES_MIN > raw.OFFKAI_HOLD_MINUTES_DEFAULT ||
    raw.OFFKAI_HOLD_MINUTES_DEFAULT > raw.OFFKAI_HOLD_MINUTES_MAX
  )
    throw new Error('hold default must be within hold bounds');
  const priceRoundingUnits = raw.OFFKAI_PRICE_ROUNDING_UNITS.split(',').map(Number);
  if (priceRoundingUnits.some((unit) => !Number.isSafeInteger(unit) || unit < 1))
    throw new Error('rounding units must be positive safe integers');

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

  if (!raw.OFFKAI_AUTH_DEV_BYPASS && !raw.OFFKAI_DATABASE_PATH) {
    throw new Error('OFFKAI_DATABASE_PATH is required when OFFKAI_AUTH_DEV_BYPASS is not enabled');
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
  if (
    !raw.OFFKAI_AUTH_DEV_BYPASS &&
    raw.OFFKAI_STRIPE_SECRET_KEY &&
    (!raw.OFFKAI_STRIPE_V2_WEBHOOK_SECRET || !raw.OFFKAI_STRIPE_PUBLISHABLE_KEY)
  )
    throw new Error('Stripe v2 webhook secret and publishable key are required with Stripe');
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
  if (raw.OFFKAI_DISCORD_SETUP_API_URL !== 'https://discord.com/api/v10') {
    const url = new URL(raw.OFFKAI_DISCORD_SETUP_API_URL);
    if (
      !raw.OFFKAI_AUTH_DEV_BYPASS ||
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password
    )
      throw new Error(
        'OFFKAI_DISCORD_SETUP_API_URL overrides require dev bypass and a loopback HTTP URL'
      );
  }
  const sessionSecret =
    raw.OFFKAI_SESSION_SECRET || (raw.OFFKAI_AUTH_DEV_BYPASS ? 'development-session-secret' : '');
  if (Buffer.byteLength(sessionSecret) < 16) {
    throw new Error('OFFKAI_SESSION_SECRET must be at least 16 bytes');
  }

  if (
    !raw.OFFKAI_AUTH_DEV_BYPASS &&
    (!raw.OFFKAI_DISCORD_APPLICATION_ID ||
      !raw.OFFKAI_DISCORD_PUBLIC_KEY ||
      !raw.OFFKAI_DISCORD_BOT_TOKEN)
  ) {
    throw new Error('Discord application ID, public key, and bot token are required in production');
  }

  return {
    tuning: tuningSchema.parse(raw),
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
      path: raw.OFFKAI_DATABASE_PATH,
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
      botToken: raw.OFFKAI_DISCORD_BOT_TOKEN,
      setupApiUrl: raw.OFFKAI_DISCORD_SETUP_API_URL,
      applicationId: raw.OFFKAI_DISCORD_APPLICATION_ID,
      publicKey: raw.OFFKAI_DISCORD_PUBLIC_KEY,
      commandGuildId: raw.OFFKAI_DISCORD_COMMAND_GUILD_ID
    },
    stripe: {
      secretKey: raw.OFFKAI_STRIPE_SECRET_KEY,
      webhookSecret: raw.OFFKAI_STRIPE_WEBHOOK_SECRET,
      v2WebhookSecret: raw.OFFKAI_STRIPE_V2_WEBHOOK_SECRET,
      merchantMcc: raw.OFFKAI_STRIPE_MERCHANT_MCC,
      publishableKey: raw.OFFKAI_STRIPE_PUBLISHABLE_KEY
    },
    platform: {
      adminDiscordIds: raw.OFFKAI_PLATFORM_ADMIN_DISCORD_IDS.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    },
    priceRoundingUnits,
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
