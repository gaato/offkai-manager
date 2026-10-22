# Configuration

All application settings are parsed and validated by `src/lib/server/config.ts` at startup.
Defaults below are source defaults, not deployment overrides. The container sets the database
path to `/data/offkai.sqlite`. Inject production values through your service manager or secret
store; the application entry point does not automatically load an `.env` file.

**Secret** marks values that must not appear in logs, source control or browser responses.
An empty default means unset. Numeric ranges are inclusive; numeric settings reject blank
strings. Booleans enable only for `true`, `1`, or `yes` (case-sensitive); unset/empty uses the
default, and any other value is false. Durations accept nonnegative decimal parts with
`ns`, `us`, `µs`, `ms`, `s`, `m`, `h`, for example `500ms` or `1h30m`; unset/empty uses `10s`.

## Server

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_HTTP_ADDR` | `:8080` | host:port; port 1–65535 | Listen address; an empty host binds to 0.0.0.0. |
| `OFFKAI_HTTP_SHUTDOWN_TIMEOUT` | `10s` | Finite nonnegative duration | Graceful shutdown timeout; adapter-node rounds up to whole seconds, at least one. |
| `OFFKAI_CLIENT_IP_HEADER` | `empty` | Header name or empty | Trusted proxy header for rate-limit identity; set only if the proxy overwrites it. |
| `OFFKAI_TIMEZONE` | `Asia/Tokyo` | Valid IANA time zone | Zone used to parse and display wall-clock times. |
| `OFFKAI_LOG_LEVEL` | `info` | debug, info, warn, error | Minimum structured log level. |
| `OFFKAI_PUBLIC_BASE_URL` | `http://127.0.0.1:8080` | Absolute HTTP(S) origin; no credentials, path, query or fragment | Public origin for redirects, CSRF checks and adapter-node ORIGIN; use HTTPS in production. |
| `OFFKAI_SESSION_SECRET` | `empty` | At least 16 UTF-8 bytes; required outside dev bypass | **Secret.** Session signing key; dev bypass supplies a development secret when empty. |
| `OFFKAI_AUTH_DEV_BYPASS` | `false` | Boolean | Enables arbitrary local login and fake Stripe; never expose this mode. |
| `OFFKAI_PLATFORM_ADMIN_DISCORD_IDS` | `empty` | Comma-separated strings (trimmed; blanks removed) | Discord user IDs granted operator access to /ops; no snowflake validation is applied here. |
| `OFFKAI_SESSION_TTL_SECONDS` | `86400` | 60–2592000 (integer) | Organizer session lifetime in seconds. |
| `OFFKAI_OAUTH_STATE_TTL_SECONDS` | `600` | 60–3600 (integer) | OAuth state lifetime in seconds. |
| `OFFKAI_LOCALE_COOKIE_TTL_SECONDS` | `31536000` | 60–31536000 (integer) | Browser locale cookie lifetime in seconds. |

## Database

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_DATABASE_PATH` | `empty` | Trimmed SQLite path without NUL, or :memory: | Required outside dev bypass; production needs a durable file, not :memory:. |
| `OFFKAI_DB_MIGRATE` | `true` | Boolean | Run Drizzle migrations during database initialization. |
| `OFFKAI_DB_BUSY_TIMEOUT_MS` | `5000` | 0–60000 (integer) | SQLite busy timeout in milliseconds. |

## Discord

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_DISCORD_CLIENT_ID` | `empty` | String; required outside dev bypass | OAuth client ID for organizer login. |
| `OFFKAI_DISCORD_CLIENT_SECRET` | `empty` | String; required outside dev bypass | **Secret.** OAuth client secret. |
| `OFFKAI_DISCORD_REDIRECT_URL` | `empty` | Absolute HTTP(S) URL without credentials or fragment | OAuth callback, normally https://offkai.example/auth/discord/callback; required outside dev bypass. |
| `OFFKAI_DISCORD_BOT_TOKEN` | `empty` | String; required outside dev bypass | **Secret.** Shared bot token for guild REST operations and command registration. |
| `OFFKAI_DISCORD_SETUP_API_URL` | `https://discord.com/api/v10` | Default only in production; dev override must be HTTP at 127.0.0.1 without credentials | Setup REST endpoint; loopback override is for fake local transports. |
| `OFFKAI_DISCORD_APPLICATION_ID` | `empty` | 17–20 decimal digits or empty; required outside dev bypass | Application ID for receiving interactions and registering commands. |
| `OFFKAI_DISCORD_PUBLIC_KEY` | `empty` | Exactly 64 hexadecimal characters or empty; required outside dev bypass | Public Ed25519 interaction-verification key; not secret. |
| `OFFKAI_DISCORD_COMMAND_GUILD_ID` | `empty` | 17–20 decimal digits or empty | Registration target guild; empty selects global commands. |
| `OFFKAI_DISCORD_REQUEST_TIMEOUT_MS` | `10000` | 100–120000 (integer) | Discord REST request timeout in milliseconds. |
| `OFFKAI_DISCORD_RETRY_AFTER_MS` | `1000` | 1–3600000 (integer) | Fallback delay when a retryable Discord response supplies no usable delay. |
| `OFFKAI_INTERACTION_DRAFT_TTL_SECONDS` | `3600` | 60–86400 (integer) | Lifetime of actor/event-scoped saved modal answers in seconds. |

## Stripe

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_STRIPE_SECRET_KEY` | `empty` | String; see credential groups below | **Secret.** Platform server API key; empty disables real Stripe. |
| `OFFKAI_STRIPE_WEBHOOK_SECRET` | `empty` | String; see credential groups below | **Secret.** Connected-account snapshot webhook signing secret. |
| `OFFKAI_STRIPE_V2_WEBHOOK_SECRET` | `empty` | String; required with Stripe outside dev bypass | **Secret.** Separate thin account-event signing secret. |
| `OFFKAI_STRIPE_PUBLISHABLE_KEY` | `empty` | String; required with Stripe outside dev bypass | Public Connect.js key; pk_test_stub is reserved for the E2E placeholder. |
| `OFFKAI_STRIPE_MERCHANT_MCC` | `7299` | Exactly four decimal digits | Merchant category copied only at connected-account creation. |

## Fees and pricing

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_PRICE_ROUNDING_UNITS` | `1,10,100` | Comma-separated decimal integers, each 1–9007199254740991; no whitespace | Available price-rounding units in minor currency units. |
| `OFFKAI_PLATFORM_FEE_BPS` | `0` | 0–9000 (integer) | Platform fee rate snapshotted at event creation; 0 omits the application fee. |
| `OFFKAI_STRIPE_FEE_BPS_ESTIMATE` | `360` | 0–9000 (integer) | Estimated Stripe processing rate for gross-up; not a guarantee of actual fees. |

## Holds

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_HOLD_MINUTES_DEFAULT` | `30` | 1–1440 (integer) | Initial organizer seat-hold duration in minutes. |
| `OFFKAI_HOLD_MINUTES_MIN` | `30` | 1–1440 (integer) | Lower organizer hold-setting bound in minutes. |
| `OFFKAI_HOLD_MINUTES_MAX` | `1440` | 31–1440 (integer) | Upper organizer hold-setting bound in minutes. |
| `OFFKAI_HOLD_TICK_INTERVAL_MS` | `15000` | 100–3600000 (integer) | Hold-expiry polling interval bound in the shared worker loop. |
| `OFFKAI_HOLD_EXPIRING_SOON_MINUTES` | `5` | 1–1440 (integer) | Threshold for a one-off hold-expiry warning. |

## Payment schedule

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_PAYMENT_REMINDER_LEAD_HOURS` | `72` | 1–8760 (integer) | Hours before a scheduled payment deadline to send the one-off automatic reminder. |

## Notifications

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_NOTIFICATION_DM_INTERVAL_MS` | `1000` | 0–60000 (integer) | Minimum spacing between notification DM attempts. |
| `OFFKAI_NOTIFICATION_ARCHIVE_DAYS` | `7` | 0–365 (integer) | Archive fallback threads this many days after the event ends. |

## Outbox

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_OUTBOX_POLL_INTERVAL_MS` | `15000` | 100–3600000 (integer) | Outbox polling interval bound in milliseconds. |
| `OFFKAI_OUTBOX_BATCH_SIZE` | `10` | 1–1000 (integer) | Maximum outbox jobs processed per batch. |
| `OFFKAI_OUTBOX_MAX_ATTEMPTS` | `5` | 1–100 (integer) | Maximum delivery attempts before an outbox job fails. |
| `OFFKAI_WORKER_ENABLED` | `true` | Boolean | Starts the in-process outbox/hold worker when a database and bot token are configured. |

## Limits

| Setting | Default | Allowed values / range | Meaning |
| --- | --- | --- | --- |
| `OFFKAI_RATE_LIMIT_WINDOW_MS` | `60000` | 1000–3600000 (integer) | Browser request rate-limit window in milliseconds. |
| `OFFKAI_RATE_LIMIT_REQUESTS` | `60` | 1–10000 (integer) | Allowed requests per rate-limit key and window. |
| `OFFKAI_RATE_LIMIT_CLEANUP_THRESHOLD` | `10000` | 100–1000000 (integer) | Rate-limit map size that triggers expiry cleanup. |
| `OFFKAI_WEBHOOK_MAX_BODY_BYTES` | `1048576` | 1024–16777216 (integer) | Maximum accepted raw Stripe webhook body size in bytes. |
| `OFFKAI_EVENT_DEFAULT_DURATION_MS` | `10800000` | 60000–604800000 (integer) | Default new-event duration in milliseconds. |
| `OFFKAI_ACTIVITY_LIMIT` | `100` | 1–1000 (integer) | Maximum event or organization activity entries returned. |
| `OFFKAI_PARTICIPANT_LIST_LIMIT` | `500` | 1–10000 (integer) | Maximum participants returned by the organizer list. |
| `OFFKAI_PLATFORM_ACTIVITY_PAGE_SIZE` | `50` | 1–1000 (integer) | Operator activity page size. |
| `OFFKAI_PLATFORM_DETAIL_AUDIT_LIMIT` | `20` | 1–1000 (integer) | Maximum audit entries on an operator detail page. |
| `OFFKAI_PLATFORM_USER_SEARCH_LIMIT` | `50` | 1–1000 (integer) | Maximum operator user-search results. |
| `OFFKAI_PLATFORM_RECENT_AUDIT_LIMIT` | `12` | 1–1000 (integer) | Maximum recent audit entries on the operator dashboard. |

## Related constraints

- Discord OAuth client ID, client secret and redirect URL must be supplied together, even
  with dev bypass. Outside dev bypass all three, the bot token, application ID, public key,
  database path and session secret are required.
- Outside dev bypass the Stripe secret key and snapshot webhook secret must be supplied
  together. Enabling Stripe also requires the v2 webhook secret and publishable key.
  The parser permits all Stripe credentials to be omitted; paid card events need them.
- Platform and estimated Stripe fee rates must sum to less than 10000 basis points.
  Fee/config changes do not rewrite stored event or payment-request snapshots.
- Hold settings must satisfy minimum ≤ default ≤ maximum. The parser permits minimum/default
  below 30, but organizer holds are clamped to Stripe's 30-minute minimum. Initial Checkout
  can extend the hold to 31 minutes to allow request transit; the configured maximum must
  accommodate this. See [ADR 0004](adr/0004-discord-paid-registration.md).

See [operations](operations.md) for production setup, endpoint secrets and backups.
