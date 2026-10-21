# Discord payments, seat holds, embedded payouts and delivery

Status: accepted.

An event selects `none`, `pay_to_confirm`, or `pay_later`. The event's primary
`collections` row holds its participant price and currency. Its card, cash, PayPay,
and waiver methods remain `collection_payment_methods`. Admission creates a
`payment_requests` snapshot for each held or confirmed participant; payment and
waiver facts remain append-only `payment_records`. There is no parallel balance
or participant-payment table. Existing open, positive-price collections migrate
to `pay_later`, preserving their prices, confirmed seats, and ledger. Other legacy
collections retain their previous workflow.

The attendance union is `none | applied | waitlisted | held { holdExpiresAt } |
confirmed | cancelled`. Payment is independent: `unpaid | checkout_open {
sessionId, expiresAt } | paid { recordId } | waived | refund_due { recordId }`.
Storage maps unpaid to `pending`, Checkout intents/open sessions to
`payment_pending`, and the other payment states to their corresponding request
status. A cancelled unpaid request remains `cancelled`; its attendance row retains
whether an unpaid hold was released. Cancelled attempts keep their reception
number. Rejoining creates another attempt instead of resurrecting one.

`events.platform_fee_bps` snapshots the configured platform rate at event creation.
Gross-up uses bigint arithmetic, rounds the participant price up to the selected
unit, estimates Stripe's fee conservatively, and floors the platform application
fee to minor units. Every request snapshots that application fee; a Stripe
settlement records it too. Manual payment/waiver records charge no platform fee.
Only the platform fee is sent as `application_fee_amount`; zero omits the field.
The estimate is not a promise about Stripe's actual fees.

New connected accounts use Accounts v2, JP individual identity, no dashboard,
Stripe fee/loss collection, and the requested merchant card capability. An owner
creates the account explicitly. Organization Stripe access retains the existing
owner-only capability because embedded sessions include account management and
refund powers. Organizers can prepare paid events once the organization's account
is ready. Account Sessions enable onboarding, the mandatory notification banner
and account management, balances, payouts, and payments with refund management.
Hosted onboarding uses authenticated organization context in return/refresh URLs;
public callback URLs contain no account ID. `ReadyConnectedAccount` is a branded
argument required by the Checkout gateway. Capability refreshes happen on the
payouts page and signed v2 account notifications.

The payouts HTML response extends SvelteKit's generated CSP with only the Connect
embedded-component sources documented by Stripe: `connect-js.stripe.com` and
`js.stripe.com` for scripts/frames, `https://*.stripe.com` for images, and the
documented empty-style SHA-256. Existing nonces and security directives survive.
No custom fonts are used, so `connect-src` remains self-only. Incoming payouts
links and all outgoing payouts navigation reload the document, because SPA data
responses cannot replace the document's CSP. Other routes keep the strict policy.
The client waits for one bounded script load and an initial Account Session before
calling the SDK's pure initializer. Failure, timeout, or component load failure
stops mounting, cleans up once, and shows a localized hosted-onboarding fallback;
there is no automatic retry. A page reload permits a fresh attempt.

Checkout reserves a durable intent in `write`, calls Stripe outside the transaction,
then re-reads attendance, event and organization state before attaching. The
request/generation pair supplies the idempotency key and Checkout reference.
`payment_checkout_sessions` retains previous sessions so replacement sessions do
not hide late money. A webhook can resolve the reserved reference before the response is attached.
Timeouts retain the same intent/key: deleting an ambiguous intent could create a
second collectible Checkout after Stripe accepted the first call. Session expiry
permits a new generation. Paid, waived, cancelled or released requests never
become payable again through an older response.

The following small ambiguities are resolved explicitly:

- Organizer hold settings are validated against config bounds and clamped to
  Stripe's 30-minute minimum. At a first Checkout with less than 31 minutes left,
  the reserved seat's deadline restarts at 31 minutes, with whole-second rounding,
  to allow time for Stripe to receive the API request. Checkout and the seat use
  that identical deadline; reads reuse it rather than extending it. The configured
  maximum must allow at least 31 minutes. Tests pin clamping, aligned deadlines,
  reuse and exact expiry.
- A successful payment received at or after the hold deadline, after withdrawal,
  after a prior manual payment/waiver, or for a cancelled event is retained as a
  settled money fact and a `refund_due` conflict. It never revives the seat. The
  existing conflict workflow records the organizer's refund evidence. A late
  webhook that releases a hold also runs vacancy promotion, so a delayed tick
  cannot strand the waitlist.
- Prices and the attendance payment requirement freeze after an obligation exists,
  so existing participants cannot acquire a different debt through a settings save.
  Accepted cash/PayPay methods can still change. A participant with an expired hold
  can select Pay to create a fresh attempt using still-valid saved answers; changed
  form requirements fall back to the registration form.
- Registrations store the participant's Discord interaction locale on successful join
  and answer edit (`ja*` becomes `ja`, all other locales become `en`). Delivery uses
  only that locale for DMs and private-thread fallbacks. Existing registrations default
  to English until a successful answer edit, because no previous preference was stored.
  This avoids bilingual messages and keeps language choices scoped to each event.
  Only registration-owned outbox jobs may initiate notifications.
- An unreachable badge means a failed kind without a successful delivery of that
  same kind. A successful private-thread fallback therefore clears its DM failure
  for reachability purposes while retaining both attempt records.

`tickOnce(client, now)` releases expired holds and queues panel refresh, role sync,
notifications and waitlist admission atomically. A recursive `setTimeout` worker
calls it using injected time. One-off hold-expiry notices are included; periodic reminders are not scheduled; reception is described in ADR 0005.

Notification jobs use DM first. Only HTTP 403 with Discord 50007/50278 permits a
private-thread fallback. The worker stores the thread, adds the participant,
sends a Components V2 message with only that user's allowed mention, and archives
the thread after the configured event-relative grace period. Unknown member
10007 stops. Every route attempt is recorded in `notification_deliveries`.
RateLimitError uses `retryAfter` to reschedule; DM spacing also reschedules rather
than sleeps. Notification claims serialize across workers to protect spacing and
lazy thread creation. Missing notification configuration records a failure.

Both Stripe endpoints consume a limited raw body once. Exact webhook paths bypass
the custom browser CSRF/rate-limit/session hooks; adjacent paths do not. Snapshot
settlement uses the idempotency ledger and one synchronous write transaction.
Checkout return pages only display localized text and allowlisted Discord links.
They never settle money.

References: [Account Sessions](https://docs.stripe.com/api/account_sessions),
[Connect embedded components](https://docs.stripe.com/connect/get-started-connect-embedded-components).

Account creation alone prefills `defaults.profile.business_url` with the public
`/legal/[orgId]` disclosure URL, localized meetup participation-fee product text,
and `configuration.merchant.mcc` from `OFFKAI_STRIPE_MERCHANT_MCC` (default `7299`).
The minimal disclosure exposes the organization name without inferred personal data.
Later Account Links, Account Sessions, and readiness refreshes never update these
fields: Stripe removes platform write permission after onboarding starts.

Connect appearance resolves the active DaisyUI semantic colors to sRGB, because
Stripe accepts hex/RGB/HSL rather than DaisyUI's OKLCH tokens. Initial appearance
and system `prefers-color-scheme` changes use the same palette, including text,
secondary text, surfaces and button text, so embedded content remains readable.
