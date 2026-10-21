# Paid event implementation reference

See [ADR 0004](adr/0004-discord-paid-registration.md) for the state/storage mapping,
transaction boundaries and ambiguity decisions.

## Configuration

All values are parsed in `src/lib/server/config.ts`. Enabling Stripe in production
requires its secret key, snapshot webhook secret, v2 webhook secret and publishable
key together. Development bypass uses the existing fake gateway; the e2e harness
explicitly clears real Stripe credentials.

| Key | Default | Purpose |
| --- | --- | --- |
| `OFFKAI_PLATFORM_FEE_BPS` | `0` | Platform rate snapshotted at event creation; zero omits the application fee. |
| `OFFKAI_STRIPE_FEE_BPS_ESTIMATE` | `360` | Gross-up estimate; combined rates must be below 10,000. |
| `OFFKAI_PRICE_ROUNDING_UNITS` | `1,10,100` | Positive integer rounding choices. |
| `OFFKAI_HOLD_MINUTES_DEFAULT` | `30` | Initial organizer hold setting. |
| `OFFKAI_HOLD_MINUTES_MIN` | `30` | Lower organizer setting bound; Stripe still requires at least 30 minutes. |
| `OFFKAI_HOLD_MINUTES_MAX` | `1440` | Upper bound, between 31 and 1,440 minutes; first Checkout may use a 31-minute operational minimum. |
| `OFFKAI_HOLD_TICK_INTERVAL_MS` | `15000` | Hold worker polling bound, shared with the outbox loop. |
| `OFFKAI_HOLD_EXPIRING_SOON_MINUTES` | `5` | One-off expiry warning threshold. |
| `OFFKAI_NOTIFICATION_DM_INTERVAL_MS` | `1000` | Minimum spacing between DM attempts. |
| `OFFKAI_NOTIFICATION_ARCHIVE_DAYS` | `7` | Archive fallback threads this many days after event end. |
| `OFFKAI_STRIPE_MERCHANT_MCC` | `7299` | Four-digit merchant category code; copied only when creating a connected account. |
| `OFFKAI_STRIPE_PUBLISHABLE_KEY` | empty | Public Connect.js key; `pk_test_stub` renders the e2e placeholder. |
| `OFFKAI_STRIPE_V2_WEBHOOK_SECRET` | empty | Separate thin-event signing secret. |

Existing `OFFKAI_STRIPE_SECRET_KEY`, `OFFKAI_STRIPE_WEBHOOK_SECRET`,
`OFFKAI_PUBLIC_BASE_URL`, `OFFKAI_OUTBOX_*`, and Discord transport tuning remain in use.
Defaults/min/max must be ordered. Domain operations receive tuning and Clock;
config changes do not replace already persisted event/request fee snapshots.

## Routes

| Route | Behavior |
| --- | --- |
| `/app/organizations/[orgId]/payouts` | Owner-only explicit account creation, live readiness refresh, embedded components and hosted fallback. |
| `/app/organizations/[orgId]/payouts/session` | Authenticated POST creates an Account Session; response is not cached. |
| `/connect/return?org=…` | Authenticates the owner, refreshes readiness, redirects to payouts. |
| `/connect/refresh?org=…` | Authenticates the owner, creates a fresh hosted link. |
| `/app/organizations/[orgId]/events/new` | Payment requirement, amount, rounding, override, estimate breakdown, manual methods and hold setting. |
| `/app/events/[eventId]/settings` | Same fields using the event's stored platform rate. |
| `/app/events/[eventId]/payments` | Existing manual receipt, waiver and refund-conflict operations. |
| `/legal/[orgId]` | Public organizer disclosure with organization name; used as the creation-time business URL. |
| `/checkout/done` | Localized receipt acknowledgement and panel-channel link; no mutation. |
| `/checkout/cancelled` | Localized return-to-Discord page; no mutation. |
| `/webhooks/stripe` | Signed connected-account snapshot events. |
| `/webhooks/stripe/v2` | Signed thin account notifications followed by related-object retrieval and live readiness refresh. |

Snapshot event types: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`.

Thin event types: `v2.core.account.created`, `v2.core.account.updated`,
`v2.core.account.closed`,
`v2.core.account[configuration.merchant].capability_status_updated`,
`v2.core.account[configuration.merchant].updated`,
`v2.core.account[requirements].updated`,
`v2.core.account[future_requirements].updated`,
`v2.core.account[identity].updated`, `v2.core.account[defaults].updated`.

## Validation coverage

Unit tests cover integer gross-up examples/properties, the complete attendance and
money-command matrices, generated lifecycle sequences, readiness call typing,
SDK payloads with fake HTTP, signed webhook parsing, webhook path exemptions,
and paid ja/en renderer limits. Integration tests cover exact hold expiry and
capacity, gated Checkout/webhook/cancel/expiry interleavings, duplicated sessions,
fee snapshots, manual/waived settlement, DM failure routing, throttling/claims,
archival, and retention of pre-migration money and answers. Signed scenarios cover
Stripe settlement, role sync, DM delivery/private fallback, expiry panel refresh,
authenticated organizer manual receipt, and thin-event readiness refresh.

The headless e2e suite includes the stub Account Session, zero real Stripe JS,
reactive price/override breakdown and pay-later manual receipt. Static return pages
and payouts are included in the ja/en route sweep.

Payouts alone extends the generated CSP according to Stripe's
[Connect embedded-component requirements](https://docs.stripe.com/connect/get-started-connect-embedded-components?platform=web#csp-and-http-header-requirements).
It allows the two documented script/frame origins, Stripe images, and the exact
empty-style hash while preserving SvelteKit's nonces. `connect-src` stays self-only
because no custom fonts are configured. Document navigation into and out of payouts
ensures the browser actually switches policies. Headless regression tests verify
the response headers, nonce preservation, strict policies on other pages, and one
localized fallback after an intercepted script failure in both languages. No real
Stripe JS is loaded. Unit tests cover loading, timeout, cancellation, initial
session failure, and secret reuse/refresh before components are mounted.

## Gate results

Verified with fake Stripe/Discord transports and headless Chromium. No live Stripe
or Discord requests, headed browser, computer-use session, or VCS operation was used.

| Gate | Result |
| --- | --- |
| `pnpm test` | PASS — 451 tests in 30 files |
| `pnpm test:integration` | PASS — 125 tests in 20 files |
| `pnpm test:scenario` | PASS — 39 tests in 4 files |
| `pnpm check` | PASS — zero errors or warnings, including readiness type checks |
| `pnpm lint` | PASS |
| `pnpm depcruise` | PASS — no dependency violations |
| `pnpm build` | PASS |
| `pnpm test:e2e` | PASS — 145 tests per run, two consecutive complete passes |

New connected accounts prefill the legal disclosure URL, localized fan-meetup
participation-fee description, and configured MCC. Existing accounts are never
updated with these fields after onboarding. Personal details are not inferred.

Registrations persist their Discord locale on successful join/answer edit.
Notifications use Japanese for `ja*`, English otherwise; existing rows start in
English. Theme colors are resolved from DaisyUI for the initial Connect.js
appearance and updated on system light/dark preference changes.
