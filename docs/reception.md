# Reception and organizer operations

## Discord commands

- `/checkin who:<number or name> [event:<event>]`: `who` autocomplete accepts `42`,
  `042` and case-insensitive display-name substrings, returning at most 25 choices.
  Each choice shows number, name and payment/check-in state. `event` autocomplete
  selects among the current guild's authorized open events; one event defaults.
- The ephemeral Components V2 reception card shows the number, name, up to five
  answer summaries, emoji plus payment text, and the original staff/time when checked
  in. Check in takes one button after selecting the person. Enabled cash/PayPay
  receipt buttons show the exact outstanding amount and also check in. Repeating
  either operation does not create another receipt or attendance record. Undo only
  undoes attendance.
- `/offkai status [event:<event>]`: confirmed/capacity, held, waitlisted, unpaid,
  totals grouped by currency, checked-in and unreachable participant counts, with
  dashboard and legal-disclosure links.
- `/offkai remind [event:<event>]`: previews held/confirmed counts, JA/EN recipient
  counts and both localized messages. Confirm queues only the previewed participants
  still unpaid. Repeating confirmation queues nothing more. Preview lifetime is
  15 minutes; a later new preview allows another deliberate reminder. Paid/cancelled
  participants are skipped again at delivery. No reminders are scheduled automatically.

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
| Signed Join handler ACK p99 | 86.54 ms | 68.11 ms |
| All 220 final replies complete | 1,816.10 ms | 3,035.51 ms |
| Simulated full outbox drain | 22,250 ms | 179,000 ms |
| Injected role 429 responses | 36 | 36 |
| 180 check-ins: mean | 4.19 ms | 8.60 ms |
| 180 check-ins: p99 | 6.16 ms | 13.27 ms |

Both runs retained exactly 180 seats and 40 waitlisted registrations, without duplicate
numbers. Join ACK p99 is asserted below 500 ms; every final response is also checked.
The paid drain includes the 180 payment notifications, so its duration reflects DM spacing.

| Gate | Result |
| --- | --- |
| `pnpm test` | PASS — 467 tests / 31 files |
| `pnpm test:integration` | PASS — 141 tests / 22 files |
| `pnpm test:scenario` | PASS — 48 tests / 5 files |
| `pnpm check` | PASS — zero errors or warnings |
| `pnpm lint` | PASS |
| `pnpm depcruise` | PASS — no boundary violations |
| `pnpm build` | PASS (also run by every e2e gate) |
| `pnpm test:e2e` | PASS — 158 Chromium tests per run, two consecutive complete passes after the final code change |

All verification uses in-memory/temporary SQLite and fake Discord/Stripe transports.
No dependencies, custom CSS, automatic reminders, VCS operations, live API calls,
computer-use sessions, headed browser or manual dev-server checks were introduced.
