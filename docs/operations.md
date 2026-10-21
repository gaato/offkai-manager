# Production operations

See [configuration](configuration.md) for every application setting and its validation.
This guide uses `https://offkai.example` as a placeholder for your public origin.

## Build and start

Use Node.js 26 and pnpm versions pinned in `mise.toml`. From a source release, run
`mise install` and `pnpm install --frozen-lockfile`. Build with the public source URL and
an immutable revision so the AGPL source link identifies the code serving users:

```sh
SOURCE_REPOSITORY=https://github.com/gaato/offkai-manager VCS_REF=RELEASE_REVISION pnpm build
node scripts/start.mjs
```

Supply configuration to the runtime environment before starting. At minimum, set a persistent
`OFFKAI_DATABASE_PATH`, a high-entropy `OFFKAI_SESSION_SECRET`, `OFFKAI_PUBLIC_BASE_URL`, and
all required Discord credentials. Configure Stripe as below before accepting card payments.
Keep `OFFKAI_AUTH_DEV_BYPASS=false`: `/auth/dev` otherwise lets visitors create arbitrary
sessions, including operator sessions. `OFFKAI_PLATFORM_ADMIN_DISCORD_IDS` grants access to
`/ops` only to explicitly listed Discord accounts.

Put an HTTPS reverse proxy in front of the app. Set `OFFKAI_PUBLIC_BASE_URL` to its exact
origin. The entry point maps this to adapter-node `ORIGIN`; if you also set `ORIGIN`, keep
it identical. Set `OFFKAI_CLIENT_IP_HEADER` only when the proxy overwrites that header,
so clients cannot choose their own rate-limit identity. Use `OFFKAI_HTTP_ADDR` for the
backend listener. Terminate with SIGTERM and allow at least the configured shutdown timeout
for in-flight requests and worker work to finish.

The Dockerfile builds the same entry point, runs as the unprivileged `node` user, and
stores SQLite at `/data/offkai.sqlite`. Mount a writable persistent volume at `/data`.
Pass `SOURCE_REPOSITORY` and `VCS_REF` as build arguments when building a release image.
`compose.yaml` is a local development example with an enabled login bypass; it is not a
production configuration and does not wire every production credential.

## One application replica and durable storage

Run exactly one application process/replica per database, without overlapping rolling
replacements. SQLite has one writer; synchronous `BEGIN IMMEDIATE` transactions serialize
mutations and audit records. The outbox, hold-expiry loop and notification scheduling run
inside the app process, and their lifecycle assumes one active application instance.
A backup sidecar is not another application replica. Do not put the database on a shared
network filesystem or scale the app by giving separate replicas independent database copies.

Persist the whole database directory, including SQLite WAL/SHM files, and preserve ownership
for the runtime user. Keep `OFFKAI_WORKER_ENABLED=true`: the worker performs role sync,
panel refresh, seat-hold expiry, notifications and native Discord event reconciliation.
Monitor failed outbox work and unresolved participant delivery failures; readiness alone
does not prove Discord or Stripe connectivity.

## Discord application

1. Create an application with a bot in the Discord Developer Portal. Use the same
   application for organizer OAuth, bot REST access and HTTP interactions.
2. Set the OAuth redirect to `https://offkai.example/auth/discord/callback` and set
   `OFFKAI_DISCORD_CLIENT_ID`, `OFFKAI_DISCORD_CLIENT_SECRET` and
   `OFFKAI_DISCORD_REDIRECT_URL`. Organizer sign-in requests the `identify` scope.
3. Set `OFFKAI_DISCORD_APPLICATION_ID`, the application's Ed25519
   `OFFKAI_DISCORD_PUBLIC_KEY`, and secret `OFFKAI_DISCORD_BOT_TOKEN`. Configure the
   Interactions Endpoint URL as `https://offkai.example/interactions` once the server is
   reachable. Discord validates it with a signed PING. Preserve the original request body
   through the proxy; signature verification runs before JSON parsing. Keep system time
   synchronized because interaction timestamps are accepted within five minutes.
4. Install the application into each organizer guild with `bot` and `applications.commands`
   scopes. The event's Discord settings provide scoped installation/permission repair links.
   A gateway connection and message-content intent are not used by this HTTP interactions bot.

Grant permissions for the features you enable, including applicable channel overwrites:

| Feature | Bot permissions / setup |
| --- | --- |
| Post and refresh registration panels | View Channels, Read Message History, Send Messages in the panel channel. |
| Participant role sync | Manage Roles; the bot's highest role must be above each assignable participant role. Managed roles and @everyone cannot be assigned. |
| Private-thread notification fallback | View Channels, Create Private Threads, Send Messages in Threads in the configured notification channel; the bot must be able to add the participant. |
| Optional layout creation | Manage Channels and Manage Roles; review the preview before applying. Existing resources are left untouched. |
| Optional Guild Scheduled Event | Create Events and Manage Events; an organizer must also manage the guild. A posted panel is required before the worker creates the projection. |
| Staff reception | No extra bot-wide permission; configure the event's staff role and let staff use `/checkin` in the intended channels. |

Administrator is not requested. Guild binding and layout creation verify the organizer's
Administrator or Manage Guild authority. Reception permits the configured Discord staff role
or an active organization organizer/owner; status/reminder commands require an organizer/owner.
Discord command visibility does not replace these application checks. Review guild integration
command permissions so staff can reach `/checkin` and organizers can reach `/offkai`.

Register commands explicitly using the configured production environment:

```sh
pnpm commands:register --dry-run
pnpm commands:register
```

Even dry-run reads the selected Discord scope; it makes no changes. Empty
`OFFKAI_DISCORD_COMMAND_GUILD_ID` selects global registration; a guild ID selects that guild.
The CLI prints normalized before/after definitions, then creates/edits only this project's
chat-input commands by name. The default preserves unrelated commands, including other
command types with the same name. `--prune` explicitly deletes other commands in the selected
scope; use `--dry-run --prune` to inspect that removal first. Builds and startup never register
commands. See [Discord's interaction setup](https://docs.discord.com/developers/interactions/overview).

## Stripe Connect

Enable Connect on the platform account and complete its platform profile. This app creates
**Accounts v2** connected accounts with `dashboard: none`, JP individual identity and the
merchant card-payment capability. Use **Stripe Managed Risk**, with both
`defaults.responsibilities.fees_collector` and `losses_collector` set to `stripe`, matching
the gateway. Confirm that your platform supports that configuration before onboarding.
See Stripe's [account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
and [Managed Risk](https://docs.stripe.com/connect/risk-management/managed-risk) guides.

The organization owner explicitly creates and onboards the connected account from the
organization payouts page. Embedded onboarding, notification banner, account management,
balances, payouts and payments/refunds provide its account UI; hosted onboarding is the fallback.
The account has no Stripe dashboard. The owner must resolve requirements until card payments
and payouts are ready. Creation prefills the public organizer disclosure URL, localized
participation-fee description and configured MCC; later readiness refreshes do not overwrite
these account fields. The current gateway is for Japanese individual organizers.

Set `OFFKAI_STRIPE_SECRET_KEY` and `OFFKAI_STRIPE_PUBLISHABLE_KEY` from the same platform and
mode. Keep live and test configuration separate. Checkout uses direct charges on the
organizer's connected account: the platform never holds the participation fees. A nonzero
configured platform application fee is separate from Stripe's processing fee estimate.
Participants enter card details only on Stripe-hosted Checkout.

Configure two HTTPS event destinations with **separate signing secrets**:

| Endpoint | Payload / scope | Signing secret |
| --- | --- | --- |
| `https://offkai.example/webhooks/stripe` | Snapshot events from **connected accounts** (`events_from: @accounts`), because Checkout runs as direct charges on the organizer's account. | `OFFKAI_STRIPE_WEBHOOK_SECRET` |
| `https://offkai.example/webhooks/stripe/v2` | Thin Accounts v2 notifications from **your account** (`events_from: @self`); related objects are retrieved with the platform key. | `OFFKAI_STRIPE_V2_WEBHOOK_SECRET` |

The scopes differ on purpose. Stripe emits `v2.core.account.*` events for v2 connected accounts on
the platform account itself, so a thin destination listening to connected accounts receives
nothing and onboarding status only changes when an organizer presses "sync".

Subscribe the snapshot destination to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`

Subscribe the thin destination to:

- `v2.core.account.created`
- `v2.core.account.updated`
- `v2.core.account.closed`
- `v2.core.account[configuration.merchant].capability_status_updated`
- `v2.core.account[configuration.merchant].updated`
- `v2.core.account[requirements].updated`
- `v2.core.account[future_requirements].updated`
- `v2.core.account[identity].updated`
- `v2.core.account[defaults].updated`

Preserve raw bodies and Stripe signature headers at both paths. Do not reuse a CLI forwarding
secret for a dashboard destination. Restart after injecting secrets. Before opening paid
registration, use Stripe test mode to verify onboarding/readiness, Checkout, signed settlement
and duplicate delivery. Successful return pages at `/checkout/done` and `/checkout/cancelled`
only acknowledge the return: they never mark a request paid. Late/duplicate payments can
require organizer refund review without restoring a cancelled or expired seat.
See [ADR 0004](adr/0004-discord-paid-registration.md) for the settlement contract.

## Organizer and door workflow

Prepare the event, questions, Discord guild/channel/roles and both panel languages in the web
UI. Paid publication requires complete organizer disclosure at the organization's disclosure
settings; the public `/legal/[orgId]` page displays organizer-provided information. Set prices,
manual methods and holds before taking registrations, because existing obligations freeze the
price/payment requirement. Review templates before posting a panel with `/offkai panel`.

- `/checkin who:<number or name> [event:<event>]` finds participants across authorized open
  events when no event is selected. Autocomplete accepts padded numbers and name substrings;
  an explicit event filters strictly. Select a person, then check in. Enabled cash/PayPay
  receipt buttons settle the displayed outstanding amount and check in together. Repeated
  clicks do not create duplicate receipts. Undo reverses attendance only. Held seats need
  settlement before admission; confirmed pay-later attendees can be checked in unpaid.
- `/offkai status [event:<event>]` shows capacity, holds, waitlist, unpaid amounts grouped
  by currency, attendance and unreachable participants. Multiple events get an event picker.
- `/offkai remind [event:<event>]` previews unpaid recipients and localized messages.
  Confirm within 15 minutes to queue that audience, rechecking unpaid status at confirmation
  and delivery. Repeating confirmation sends no second campaign; a new preview permits a
  deliberate later reminder. There are no automatic periodic payment reminders.

Before arriving, print `/app/events/[eventId]/check-in/roster` or save its sibling `roster.csv`
from the check-in page. Reconcile handwritten changes after connectivity returns. Multiple
outstanding payment obligations require the payments screen rather than an ambiguous door
receipt. Review unresolved delivery codes and fallback thread links on the participants page.

Notifications try DMs first; eligible DM privacy failures fall back to a private thread in
the configured notification channel. Delivery uses the stored participant locale and rate
limits are retried by the worker. Fallback threads archive after the configured number of days
from event end. Optional native Guild Scheduled Events follow the app event and link to its
panel; disabling/cancelling requires confirmation. An already-started projection is removed
when cancellation cannot be represented in Discord. [ADR 0005](adr/0005-discord-reception.md)
records reception and projection decisions.

## Backups and restore

Keep backups outside the application volume. Optional Litestream continuously replicates SQLite
WAL data to a generic S3-compatible bucket. Pin and test the Litestream version you deploy;
its config syntax differs between releases. For current single-replica configuration, a
separate `/etc/litestream.yml` can use:

```yaml
dbs:
  - path: /data/offkai.sqlite
    replica:
      type: s3
      bucket: offkai-backups
      path: production/offkai
      endpoint: ${BACKUP_S3_ENDPOINT}
      region: ${BACKUP_S3_REGION}
      access-key-id: ${BACKUP_S3_ACCESS_KEY_ID}
      secret-access-key: ${BACKUP_S3_SECRET_ACCESS_KEY}
```

These `BACKUP_*` values belong to Litestream, not application config. Inject bucket credentials
privately, restrict access to the backup prefix, and choose retention for your recovery needs.
Run Litestream alongside the single application process with access to the same local volume:

```sh
litestream replicate -config /etc/litestream.yml
```

Monitor replication errors and backup age. A healthy app is not evidence of a restorable backup.
For a recovery drill or disaster restore, stop the application and replication first, retain
the original database directory with its WAL/SHM files, and restore to a new, empty output path:

```sh
litestream restore -config /etc/litestream.yml -o /data/restored.sqlite /data/offkai.sqlite
sqlite3 /data/restored.sqlite 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

The final path selects the database entry in Litestream's configuration. Inspect the restored
file with the matching application release before enabling worker delivery. With all processes
stopped, place the verified restored file at `OFFKAI_DATABASE_PATH` with runtime ownership;
keep stale WAL/SHM files with the old database, not beside the restored one. Resume one app and
replication, then check readiness and organizer data. Record the recovery point; external
payments/Discord effects may have happened after it and need reconciliation. Do not copy only
the live `.sqlite` file while WAL writes continue.

See Litestream's [S3-compatible guide](https://litestream.io/guides/s3-compatible/),
[configuration reference](https://litestream.io/reference/config/) and
[restore reference](https://litestream.io/reference/restore/) for version-specific options.

## Health and upgrades

`GET /healthz` returns process liveness. `GET /readyz` checks SQLite and returns 503 when
unavailable; the container healthcheck uses readiness. Migrations run during database
initialization before it is ready when `OFFKAI_DB_MIGRATE=true` (the default). Neither health
endpoint probes live Discord/Stripe or guarantees the outbox is draining.

Before upgrading, verify a restorable backup and review release notes/configuration changes.
Stop the old replica, build/install the new release (including `drizzle/` and `scripts/`),
then start one new replica against the existing persistent volume. Let startup migrations
finish and check readiness, organizer login/data and worker logs. Register commands explicitly
if their definitions changed. Do not rebuild `build/` underneath a running server.
Rollback may require restoring the pre-upgrade backup with the matching old release; there
are no automatic down-migrations.

The initial public release has one fresh schema baseline. Pre-release development databases
from the earlier migration chain are not an upgrade source: recreate disposable development
databases rather than applying the baseline to them. Future release migrations build on this
baseline. For contributors, generate migrations with `pnpm exec drizzle-kit generate --name=NAME`,
then preserve manual SQLite STRICT declarations and SQL-only objects (the reception-number
trigger and notification delivery index). The baseline also retains integer boolean defaults
and the existing unnamed locale check. Keep the strict migration ledger in `db/migrate.ts` and
run the integration schema parity tests, because drizzle-kit does not capture every SQLite detail.
