# Reception and organizer operations

## Discord commands

- `/checkin who:<number or name> [event:<event>]`: `who` autocomplete accepts `42`,
  `042` and case-insensitive display-name substrings, returning at most 25 choices.
  Each choice shows number, name and payment/check-in state. With no `event` filter,
  search spans all authorized open events; multiple-event results include a short event
  title prefix. Selecting a person resolves their stored event. `event` autocomplete
  selects among the current guild's authorized open events and strictly filters `who`;
  mismatched event/participant choices are rejected. One event defaults for raw text.
  Status/remind show an ephemeral event select when several authorized events are
  open and no event was specified. Selection updates that same message; lists above
  25 events offer page buttons.
  Event-selection and authorization rejections use separate JA/EN messages.
- The ephemeral Components V2 reception card shows the number in its own heading,
  followed by the name, up to five
  answer summaries, emoji plus payment text, and the original staff/time when checked
  in. Check in takes one button after selecting the person. Enabled cash/PayPay
  receipt buttons show the exact outstanding amount and also check in. Repeating
  either operation does not create another receipt or attendance record. Undo only
  undoes attendance. All reception button actions update the existing card in place.
- `/offkai status [event:<event>]`: confirmed/capacity, held, waitlisted, unpaid,
  totals grouped by currency, checked-in and unreachable participant counts, with
  dashboard and legal-disclosure links.
- `/offkai remind [event:<event>]`: previews held/confirmed counts, JA/EN recipient
  counts and both localized messages. Confirm queues only the previewed participants
  still unpaid. Repeating confirmation queues nothing more. Preview lifetime is
  15 minutes; a later new preview allows another deliberate reminder. Paid/cancelled
  participants are skipped again at delivery. Confirmation replaces the preview with
  a delivery-queue receipt and removes its button. No reminders are scheduled automatically.

Reception requires the event's Discord staff role or an organization organizer/owner.
Every action checks the actual guild binding and current authorization. Staff need no
browser account, OAuth login or organization membership. Status/remind require an active
organizer/owner. Suspended actors/organizations and draft/cancelled/archived events reject
actions. The command definitions are ready for the existing `pnpm commands:register`
workflow; no command registration or real Discord call was made for this implementation.

## Organizer web

The check-in page links to `/app/events/[eventId]/check-in/roster` and its sibling
`roster.csv`. Both sort numerically and include number, display name, payment state,
payment method and checked-in state. Print navigation is hidden with Tailwind utilities.
Print/save before arriving, then reconcile handwritten changes after connectivity returns.
The participants page shows unresolved delivery failure codes and the saved fallback
thread link, even when the thread did not successfully deliver the notification.

Organization settings at `/app/organizations/[orgId]/disclosure` collect seller name,
address and phone (or disclosure without delay upon email request), email, additional
fees (none / card fees included), and a default cancellation/refund policy. The public
JA/EN `/legal/[orgId]` page additionally explains per-event prices, Stripe card payment at
registration, configured cash/PayPay, delivery on the event date, and priority of an
event's own cancellation/refund policy. It is noindex and explicitly organizer-provided.
Paid publication and conversion of a published free event to paid require a complete
disclosure. The event dashboard links to the preparation step; paid Discord panels and
status cards link to the public disclosure.

The event Discord page has an optional native-event toggle. Creation waits for a panel,
then outbox work creates/updates an external Guild Scheduled Event with start/end, venue
(or TBA for missing/private venues), and the panel-message link. Enabling requires the
organizer to manage that guild and the bot to have Create Events and Manage Events.
Missing permissions show a scoped add-permissions link. Disabling asks for confirmation;
cancelling the application event cancels the native projection too. If the projection
has already started, it is removed because Discord does not support ACTIVE-to-CANCELED. No existing foreign
scheduled event is modified by name alone.

Fallback notification threads are archived on the existing worker tick at
`event.endsAt + OFFKAI_NOTIFICATION_ARCHIVE_DAYS`. The injected-clock test covers one
millisecond before, the exact boundary, and repeated archival.

## Decisions and verification

[ADR 0005](adr/0005-discord-reception.md) records the small ambiguity decisions, including
unpaid pay-later admission, money-preserving undo, multiple legacy obligations, actor-bound
reminder previews, reception's definition of an open event, and deferred admission ACKs.

All HTTP scenario inputs are Ed25519 signed. Fake Discord transports inject JSON-only
429 responses on selected role calls; no retry may precede its retry_after. Both
variants assert 180 seats and 40 waitlisted people from 220 concurrent joins, unique
reception numbers, all final replies, all eventual role syncs and complete outbox drain.
The 180 sequential paid check-ins use the real manual-settlement handler path. The
simulated drain poll is 1,000 ms and DM spacing is the existing 1,000 ms.

Final rehearsal sample (in-process measurements, not Discord network latency):

| Metric | Free | Pay to confirm |
| --- | ---: | ---: |
| Signed Join handler ACK p99 | 72.58 ms | 60.55 ms |
| All 220 final replies complete | 1,770.17 ms | 2,457.38 ms |
| Simulated full outbox drain | 23,000 ms | 179,000 ms |
| Injected role 429 responses | 37 | 36 |
| 180 check-ins: mean | 3.45 ms | 6.27 ms |
| 180 check-ins: p99 | 3.88 ms | 6.97 ms |

Both runs retained exactly 180 seats and 40 waitlisted registrations, without duplicate
numbers. Join ACK p99 is asserted below 500 ms; every final response is also checked.
The paid drain includes the 180 payment notifications, so its duration reflects DM spacing.

| Gate | Result |
| --- | --- |
| `pnpm test` | PASS — 482 tests / 31 files |
| `pnpm test:integration` | PASS — 141 tests / 22 files |
| `pnpm test:scenario` | PASS — 60 tests / 5 files |
| `pnpm check` | PASS — zero errors or warnings |
| `pnpm lint` | PASS |
| `pnpm depcruise` | PASS — no boundary violations |
| `pnpm build` | PASS (also run by every e2e gate) |
| `pnpm test:e2e` | PASS — 158 Chromium tests per run, two consecutive complete passes after the final code change |

All verification uses in-memory/temporary SQLite and fake Discord/Stripe transports.
No dependencies, custom CSS, automatic reminders, VCS operations, live API calls,
computer-use sessions, headed browser or manual dev-server checks were introduced.

## Live-run follow-up

Signed HTTP scenario coverage uses a typed `APIChatInputApplicationCommandInteraction`
with top-level `who`/`event` string options for `/checkin` (both option orders) and
nested `event` options for `/offkai status` and `/offkai remind`. The fixture has two
open events in the same organization and an owner without a Discord staff role.
These explicit-event cases passed before the follow-up changes in this checkout;
the reported live explicit-event rejection was not reproduced locally. The router
now maps the two top-level fields explicitly. The organizer subsequently confirmed
that explicit-event submission works in a live run after these changes. The cases
remain regression coverage; the original failure cause is not established.
Cross-event discovery, registration-based event resolution, strict explicit filtering,
unauthorized-event exclusion, global ranking/25-choice and 100-character limits,
and distinct JA/EN rejections are also pinned by signed HTTP scenarios.

The first follow-up E2E attempt was interrupted by replacement of `build/` while
the test server was serving its previous assets (`ENOENT` on the old JS filename).
The organizer confirmed a manual rebuild caused that interruption. It is recorded
as a failed attempt, not as a product regression; the consecutive passing gate
runs are performed afterward with the build output left in place.

## In-place reception UX follow-up

Reception buttons and reminder confirmation now use `UPDATE_MESSAGE` (type 7),
retaining the original ephemeral message and replacing all its components. A queued
reminder receipt has no confirm button. Status/remind event ambiguity is resolved
with a localized string select and codec actions (`reception_pick`, `reception_page`),
including pagination above 25 candidates. The selected event and current organizer
permissions/guild binding are checked again on every callback. A staff role alone
does not grant status/remind access. Malformed select values and mismatched
component kinds are rejected before effects. The reception number is a standalone
heading, with the escaped name below it.

Signed HTTP scenarios pin response types/flags, check-in/receipt/repeat/undo behavior,
menu selection through reminder confirmation, authorization after menu creation,
and a 26-event pagination flow. Unit tests pin codec parsing, malformed values,
JA/EN selector limits, last-page clamping and the standalone padded number heading.
