# offkai-manager

ファン主催イベントの参加費回収・当日受付を扱う主催者向け Web UI です。参加者向けの操作は今後 Discord bot へ移行します。主催者の Stripe Connect アカウントへ直接決済するため、
プラットフォームは資金を預かりません。画面は日本語と英語に対応し、JavaScript が
使えない環境でも主要なフォームを送信できます。

This is a bilingual organizer web UI for fan-run events, direct-to-organizer payments, and check-in; participant interactions are moving to a Discord bot. See
[the platform roadmap](docs/design/platform-roadmap.md) for product direction and
[the ADR index](docs/adr/README.md) for implementation decisions.

## Quick start

[mise](https://mise.jdx.dev/) installs the pinned Node.js and pnpm versions. SQLite runs in the app process; integration tests use isolated in-memory databases.

```fish
mise install
pnpm install
env OFFKAI_DATABASE_PATH=./offkai.sqlite \
  OFFKAI_AUTH_DEV_BYPASS=true pnpm dev
```

Open `http://127.0.0.1:5173/auth/dev` to create a local session. The development bypass lets any
visitor mint arbitrary sessions, including platform-administrator sessions. Never enable it on a
shared or production instance.

To exercise the adapter-node production entry point from source:

```fish
env SOURCE_REPOSITORY=https://github.com/gaato/offkai-manager \
  VCS_REF=(git rev-parse HEAD) pnpm build
env OFFKAI_DATABASE_PATH=./offkai.sqlite \
  OFFKAI_AUTH_DEV_BYPASS=true node scripts/start.mjs
```

The complete local container stack is available with `docker compose up --build`. Its credentials
and session secret are development defaults only.

## Configuration

Production starts with validation and fails fast when required values are missing or malformed.
Durations accept Go-style units such as `500ms`, `10s`, `30m`, or `1h30m`.

| Variable                            | Default                 | Required and purpose                                                                                                                      |
| ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `OFFKAI_HTTP_ADDR`                  | `:8080`                 | Listen address in `host:port` form.                                                                                                       |
| `OFFKAI_HTTP_SHUTDOWN_TIMEOUT`      | `10s`                   | Adapter-node graceful shutdown timeout.                                                                                                   |
| `OFFKAI_CLIENT_IP_HEADER`           | empty                   | Trusted reverse-proxy header used for request rate-limit keys, for example `X-Forwarded-For`. Leave empty unless the proxy overwrites it. |
| `OFFKAI_TIMEZONE`                   | `Asia/Tokyo`            | IANA time zone for all wall-clock parsing and display.                                                                                    |
| `OFFKAI_LOG_LEVEL`                  | `info`                  | One of `debug`, `info`, `warn`, or `error`.                                                                                               |
| `OFFKAI_DATABASE_PATH`              | empty                   | SQLite file path (or `:memory:`). Required unless the development bypass is enabled.                                                      |
| `OFFKAI_DB_MIGRATE`                 | `true`                  | Apply Drizzle migrations during server initialization. The single replica can safely apply migrations at startup.                         |
| `OFFKAI_PUBLIC_BASE_URL`            | `http://127.0.0.1:8080` | Public HTTP(S) origin without a path. Used for redirects, same-origin checks, and adapter-node `ORIGIN`.                                  |
| `OFFKAI_SESSION_SECRET`             | empty                   | Session-signing secret of at least 16 bytes. Required outside the development bypass; use a high-entropy secret in production.            |
| `OFFKAI_AUTH_DEV_BYPASS`            | `false`                 | Enables `/auth/dev` and development Stripe stand-ins. Production must keep this false.                                                    |
| `OFFKAI_DISCORD_CLIENT_ID`          | empty                   | Discord OAuth application client ID. Required with the next two OAuth values outside the development bypass.                              |
| `OFFKAI_DISCORD_CLIENT_SECRET`      | empty                   | Discord OAuth application secret. Keep secret.                                                                                            |
| `OFFKAI_DISCORD_REDIRECT_URL`       | empty                   | Absolute OAuth callback URL, normally `https://HOST/auth/discord/callback`.                                                               |
| `OFFKAI_DISCORD_BOT_TOKEN`          | empty                   | Shared Discord bot token for guild checks and participant role sync. Required outside the development bypass.                             |
| `OFFKAI_DISCORD_APPLICATION_ID`     | empty                   | Discord application ID (17–20 digit snowflake); required in production.                                                                   |
| `OFFKAI_DISCORD_PUBLIC_KEY`         | empty                   | Ed25519 public key, exactly 64 hexadecimal characters; required in production.                                                            |
| `OFFKAI_DISCORD_COMMAND_GUILD_ID`   | empty                   | Register commands in this guild; leave empty for global commands.                                                                         |
| `OFFKAI_STRIPE_SECRET_KEY`          | empty                   | Stripe platform secret key. Outside the development bypass it must be configured together with the webhook secret.                        |
| `OFFKAI_STRIPE_WEBHOOK_SECRET`      | empty                   | Signing secret for the connected-account Stripe webhook endpoint.                                                                         |
| `OFFKAI_PLATFORM_ADMIN_DISCORD_IDS` | empty                   | Comma-separated Discord user IDs allowed to access `/ops`.                                                                                |
| `OFFKAI_WORKER_ENABLED`             | `true`                  | Starts the Discord role-sync outbox worker when the database and bot token are present.                                                   |

Boolean values are enabled by `true`, `1`, or `yes`; an empty value uses the documented default.
Discord OAuth values are an all-or-none group. In production the Stripe key and webhook secret are
also an all-or-none pair.

## Tests and checks

```fish
pnpm check              # Svelte and TypeScript checks
pnpm lint               # ESLint and Prettier
pnpm depcruise          # architecture boundaries
pnpm test               # Vitest unit suite
pnpm test:scenario      # Signed Discord HTTP interactions
pnpm test:integration   # Vitest with isolated in-memory SQLite
pnpm test:e2e           # Chromium acceptance suite against a built app
pnpm test:e2e:all       # all configured Playwright browser projects
pnpm build              # adapter-node production build
```

Integration and E2E tests use SQLite and do not need Docker. The acceptance ports can be overridden
with `OFFKAI_E2E_PRIMARY_PORT` and `OFFKAI_E2E_PRODUCTION_PORT`.

## Discord interactions

Configure Discord's Interactions Endpoint URL as `https://HOST/interactions`. The endpoint
verifies Ed25519 signatures on the unchanged request text before parsing JSON, and accepts
signed timestamps within five minutes in either direction to bound replay and clock skew.
The interaction locale controls replies independently of browser language cookies.

`/offkai web` opens `/app` and creates the actor's personal organization with owner membership
on first use. The personal organization is separate from existing team organizations; its
initial name is the Discord display name. Suspended accounts cannot create organizations,
and using the command does not restore suspended organizations or disabled memberships.
`/offkai panel`, `/offkai status`, `/offkai remind`, and `/checkin` currently reply “coming soon”.
Check-in autocomplete returns no candidates until the event lookup is implemented. Both
commands are guild-only; `/offkai` defaults to Manage Guild permission.

Register commands after reviewing the dry-run output:

```fish
pnpm commands:register --dry-run
pnpm commands:register
```

Registration fetches existing commands with localization maps, prints normalized before/after
JSON, then creates or edits only this project's chat-input commands by name. Other commands,
including different command types with the same name, remain untouched. `--prune` explicitly
also deletes other commands in the selected scope; `--dry-run --prune` previews that deletion.
No registration runs during builds or application startup.

The custom ID wire contract starts with `om1`: `om1:web` and
`om1:soon:<panel|status|remind|checkin>`. These versioned decoders must remain available for
buttons already posted to Discord. IDs select behavior; identity comes from the signed actor.
Deferred replies set the ephemeral flag; Components V2 is applied on the eventual message,
as Discord only permits the ephemeral flag on a deferred acknowledgement.

## Deployment

Build images with the source repository and immutable revision. Those values create the AGPL source
link in the page footer and the OCI source labels.

```fish
docker build \
  --build-arg SOURCE_REPOSITORY=https://github.com/gaato/offkai-manager \
  --build-arg VCS_REF=(git rev-parse HEAD) \
  --tag offkai-manager:(git rev-parse --short HEAD) .
```

The image runs as the unprivileged `node` user. `GET /healthz` is a process liveness check;
`GET /readyz` checks SQLite and is the container healthcheck. Migrations run before the server
becomes ready when `OFFKAI_DB_MIGRATE=true`. Run one process with one replica and keep the SQLite
database at `OFFKAI_DATABASE_PATH` on a persistent volume (the image defaults to `/data/offkai.sqlite`).
Terminate the process with `SIGTERM` so adapter-node and the in-process outbox worker can finish
their in-flight work.

### Stripe operational handoff

Before enabling card collection in production:

1. Enable Stripe Connect on the platform account and complete the platform profile. Organizers use
   Express connected accounts; Checkout creates direct charges on those accounts.
2. Create an HTTPS webhook endpoint at `https://HOST/webhooks/stripe` and choose **Listen to events
   on connected accounts**. A platform-account-only endpoint will not see these payments.
3. Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
4. Put the endpoint signing secret in `OFFKAI_STRIPE_WEBHOOK_SECRET` and the matching platform key in
   `OFFKAI_STRIPE_SECRET_KEY`. Restart, then verify a test payment reaches the endpoint and settles
   exactly once.

A Stripe return URL is never payment evidence. Only the signed webhook, the development payment
action, or an explicit organizer action can settle a request.

### Discord application and bot

Create one Discord application for the deployment. Add the exact
`OFFKAI_DISCORD_REDIRECT_URL` to OAuth2 redirects; sign-in requests only the `identify` scope. Create
a bot in the same application, enable the Server Members Intent used by membership checks, and store
its token in `OFFKAI_DISCORD_BOT_TOKEN`.

The deployment uses one shared bot across organizer guilds. Generate an installation URL with the
`bot` scope and invite it separately to every guild that will use membership gates or role sync.
Grant **Manage Roles** for participant-role updates, and place the bot's highest role above every
role it will assign. The bot must remain a guild member for membership checks. When an organizer
binds an event to a guild, the application uses the shared bot to verify that the organizer has
Administrator or Manage Guild permission in that guild; knowing a guild ID alone is not enough.
Removing the bot or lowering its role causes role-sync retries and eventually failed outbox rows
described in
[the operations runbook](docs/operations-runbook.md).

`OFFKAI_PLATFORM_ADMIN_DISCORD_IDS` is independent of guild roles. Only explicitly listed Discord
user IDs receive platform-wide `/ops` access.

## Operations

The [operations runbook](docs/operations-runbook.md) covers startup, migrations, backups, the outbox
worker, suspensions, event payment conflicts and
personal-data erasure. Architecture constraints and commands for contributors are recorded in
[AGENTS.md](AGENTS.md).

## License

Copyright (C) 2026 offkai-manager contributors.

Except for the third-party material identified below, this repository is free software: you can
redistribute it and/or modify it under the GNU Affero General Public License as published by the
Free Software Foundation, either version 3 of the License, or (at your option) any later version
(`AGPL-3.0-or-later`). See [LICENSE](LICENSE).

Commercial use, including a competing hosted service, is permitted. If you modify the program and
let users interact with it remotely over a computer network, AGPL section 13 requires you to offer
those users the Corresponding Source of the version they are using. Published builds therefore
link to the source tree for their exact Git revision from the shared page footer.

Third-party material remains under its original terms. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
