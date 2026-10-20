# offkai-manager

ファン主催イベントの申込、参加費の回収、当日受付と、応援企画の集金・完了報告を扱う
Web アプリケーションです。主催者の Stripe Connect アカウントへ直接決済するため、
プラットフォームは資金を預かりません。画面は日本語と英語に対応し、JavaScript が
使えない環境でも主要なフォームを送信できます。

This is a bilingual, server-rendered operations application for fan-run events and support
campaigns. It combines registration, direct-to-organizer payments, check-in, campaign pledges, and
completion reporting in a SvelteKit and TypeScript service. See
[the platform roadmap](docs/design/platform-roadmap.md) for product direction and
[the ADR index](docs/adr/README.md) for implementation decisions.

## Quick start

[mise](https://mise.jdx.dev/) installs the pinned Node.js and pnpm versions. Docker is needed for
PostgreSQL and the integration tests.

```fish
mise install
pnpm install
docker compose up -d db
env OFFKAI_DATABASE_URL=postgres://offkai:offkai@127.0.0.1:5432/offkai \
  OFFKAI_AUTH_DEV_BYPASS=true pnpm dev
```

Open `http://127.0.0.1:5173/auth/dev` to create a local session. The development bypass lets any
visitor mint arbitrary sessions, including platform-administrator sessions. Never enable it on a
shared or production instance.

To exercise the adapter-node production entry point from source:

```fish
env SOURCE_REPOSITORY=https://github.com/gaato/offkai-manager \
  VCS_REF=(git rev-parse HEAD) pnpm build
env OFFKAI_DATABASE_URL=postgres://offkai:offkai@127.0.0.1:5432/offkai \
  OFFKAI_AUTH_DEV_BYPASS=true node scripts/start.mjs
```

The complete local container stack is available with `docker compose up --build`. Its credentials
and session secret are development defaults only.

## Configuration

Production starts with validation and fails fast when required values are missing or malformed.
Durations accept Go-style units such as `500ms`, `10s`, `30m`, or `1h30m`.

| Variable                            | Default                 | Required and purpose                                                                                                                                            |
| ----------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OFFKAI_HTTP_ADDR`                  | `:8080`                 | Listen address in `host:port` form.                                                                                                                             |
| `OFFKAI_HTTP_SHUTDOWN_TIMEOUT`      | `10s`                   | Adapter-node graceful shutdown timeout.                                                                                                                         |
| `OFFKAI_CLIENT_IP_HEADER`           | empty                   | Trusted reverse-proxy header used for request rate-limit keys, for example `X-Forwarded-For`. Leave empty unless the proxy overwrites it.                       |
| `OFFKAI_TIMEZONE`                   | `Asia/Tokyo`            | IANA time zone for all wall-clock parsing and display.                                                                                                          |
| `OFFKAI_LOG_LEVEL`                  | `info`                  | One of `debug`, `info`, `warn`, or `error`.                                                                                                                     |
| `OFFKAI_DATABASE_URL`               | empty                   | PostgreSQL URL. Required unless the development bypass is enabled.                                                                                              |
| `OFFKAI_DB_MAX_OPEN_CONNS`          | `10`                    | Maximum database connections; must be greater than zero.                                                                                                        |
| `OFFKAI_DB_MAX_IDLE_CONNS`          | `5`                     | Idle connection limit; from zero through the open-connection limit.                                                                                             |
| `OFFKAI_DB_CONN_MAX_LIFETIME`       | `30m`                   | Maximum connection lifetime.                                                                                                                                    |
| `OFFKAI_DB_MIGRATE`                 | `true`                  | Apply Drizzle migrations during server initialization. Set false only when a separate release step owns migrations.                                             |
| `OFFKAI_PUBLIC_BASE_URL`            | `http://127.0.0.1:8080` | Public HTTP(S) origin without a path. Used for redirects, same-origin checks, and adapter-node `ORIGIN`.                                                        |
| `OFFKAI_SESSION_SECRET`             | empty                   | Session-signing secret of at least 16 bytes. Required outside the development bypass; use a high-entropy secret in production.                                  |
| `OFFKAI_AUTH_DEV_BYPASS`            | `false`                 | Enables `/auth/dev` and development Stripe stand-ins. Production must keep this false.                                                                          |
| `OFFKAI_DISCORD_CLIENT_ID`          | empty                   | Discord OAuth application client ID. Required with the next two OAuth values outside the development bypass.                                                    |
| `OFFKAI_DISCORD_CLIENT_SECRET`      | empty                   | Discord OAuth application secret. Keep secret.                                                                                                                  |
| `OFFKAI_DISCORD_REDIRECT_URL`       | empty                   | Absolute OAuth callback URL, normally `https://HOST/auth/discord/callback`.                                                                                     |
| `OFFKAI_DISCORD_BOT_TOKEN`          | empty                   | Shared Discord bot token for guild checks and participant role sync. Without it those controls are inactive.                                                    |
| `OFFKAI_STRIPE_SECRET_KEY`          | empty                   | Stripe platform secret key. Outside the development bypass it must be configured together with the webhook secret.                                              |
| `OFFKAI_STRIPE_WEBHOOK_SECRET`      | empty                   | Signing secret for the connected-account Stripe webhook endpoint.                                                                                               |
| `OFFKAI_PLATFORM_ADMIN_DISCORD_IDS` | empty                   | Comma-separated Discord user IDs allowed to access `/ops`.                                                                                                      |
| `OFFKAI_WORKER_ENABLED`             | `true`                  | Starts the leased Discord role-sync outbox worker when the database and bot token are present.                                                                  |
| `OFFKAI_CAMPAIGNS_ENABLED`          | `false`                 | Enables public and organizer campaign surfaces. Publication remains gated on legal review; do not enable this flag in production until that review is complete. |
| `OFFKAI_ABUSE_REPORT_EMAIL`         | empty                   | Optional abuse-report mailbox. When set, public campaign and pledge pages show a report link. The mailbox owner must triage incoming reports.                   |

Boolean values are enabled by `true`, `1`, or `yes`; an empty value uses the documented default.
Discord OAuth values are an all-or-none group. In production the Stripe key and webhook secret are
also an all-or-none pair.

## 応援企画

The TypeScript application ships an order core with one consumer: the support-campaign vehicle.
Campaign orders support guest checkout, quantity and money snapshots, bearer-token status pages,
Stripe Checkout settlement, expiration, a complete organizer ledger, and paid-only public totals.
Event registration fees remain a separate obligation ledger; ticket and reservation vehicles are
not planned for this branch.

応援企画は次の 4 点を固定した建付けです。

1. All-In のみとし、表示上の目標に届かなくても自動返金しない。
2. 応援者名簿への掲載を対価として扱う。掲載は応援者が明示的に選べる。
3. 履行日を必須情報として扱い、幹事が実施時期を明らかにする。
4. 目標額は表示専用であり、企画実施や決済成立の条件にしない。

受付終了後、幹事は履行結果と支出の内訳を完了報告として公開できます。この完了報告
は付随的なお知らせではなく、応援企画の信用を支えるプロダクト機能です。受付を再開
すると報告は公開ページから隠れ、再度受付を終了すると表示されます。

特定商取引法の表示では販売者である幹事 organization の名称を匿名化せず開示します。
所在地と電話番号は同法第 11 条ただし書に基づいて省略し、申込み前の請求に対して
遅滞なく開示する旨と請求窓口を掲載します。法的整理の根拠は main ブランチの
`docs/research/legal-gate-desk-research.md` を参照してください。応援企画の本番公開は、
この整理に対する法務レビューが完了するまで機能フラグで停止します。

## Tests and checks

```fish
pnpm check              # Svelte and TypeScript checks
pnpm lint               # ESLint and Prettier
pnpm depcruise          # architecture boundaries
pnpm test               # Vitest unit suite
pnpm test:integration   # Vitest with real PostgreSQL testcontainers
pnpm test:e2e           # Chromium acceptance suite against a built app
pnpm test:e2e:all       # all configured Playwright browser projects
pnpm build              # adapter-node production build
```

Integration and E2E tests require a working Docker daemon. The acceptance ports can be overridden
with `OFFKAI_E2E_PRIMARY_PORT` and `OFFKAI_E2E_PRODUCTION_PORT`.

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
`GET /readyz` checks PostgreSQL and is the container healthcheck. Migrations run before the server
becomes ready when `OFFKAI_DB_MIGRATE=true`. During a multi-replica rollout, use backward-compatible
migrations or assign one migration owner and set `OFFKAI_DB_MIGRATE=false` on the other replicas.
Terminate the process with `SIGTERM` so adapter-node and the in-process outbox worker can finish
their in-flight work.

### Stripe operational handoff

Before enabling card collection in production:

1. Enable Stripe Connect on the platform account and complete the platform profile. Organizers use
   Express connected accounts; Checkout creates direct charges on those accounts.
2. Create an HTTPS webhook endpoint at `https://HOST/webhooks/stripe` and choose **Listen to events
   on connected accounts**. A platform-account-only endpoint will not see these payments.
3. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and
   `checkout.session.expired`. Expiration reconciles campaign pledge sessions without marking them
   paid.
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
worker, suspensions, event and campaign payment conflicts, abuse reports, completion reports, and
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
