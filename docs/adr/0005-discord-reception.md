# Discord reception and organizer operations

Status: accepted.

Reception reuses `checkin_records` and the existing manual settlement transaction. A
Discord identity is linked on interaction without a browser session or organization
membership. Every lookup and mutation verifies the stored guild binding, actor and
organization suspension, then either the event staff role from the signed interaction
or an active organizer/owner membership. Organization staff membership alone does not
substitute for the configured Discord role. Status and reminder operations require an
organizer/owner. Slash commands have no default Manage Guild restriction because an
organization organizer does not necessarily manage the Discord guild; the application
performs its own authorization on every invocation.

A held seat must be settled before admission. Confirmed pay-later participants may
check in unpaid, so staff can handle an exceptional payment separately without losing
the arrival record. A cash/PayPay receipt settles the request and checks in atomically.
Only enabled system cash/PayPay methods on a single outstanding request are offered;
multiple legacy obligations require the existing payments screen, avoiding an ambiguous
amount or collection at the door. A stable request idempotency key, terminal request
checks and one synchronous write prevent a second manual receipt, even when stale
buttons select different methods. Undo removes attendance only; it never reverses money.
Expired held seats reject settlement and roll back the entire receipt/check-in write.

Open reception choices mean published, non-cancelled, non-archived events that have not
ended. Registration closing does not close reception. Exactly one authorized open event
is the default for status/reminder commands and unselected participant text. Without
an explicit event filter, participant autocomplete searches all authorized open events
and prefixes choices with a short event title, because reception should not require
choosing an event before finding a person. A selected registration resolves its own
event; an explicit event remains a strict filter. Lookups and mutations still authorize
against the registration's actual event, independently of autocomplete values. Number
matches rank before name substrings, with numeric reception order as the tie-breaker
and event start/id order for identical numbers. The merged result is capped at 25.
Ambiguous event selection and insufficient authorization have separate localized
messages so staff can tell which action is needed. Status/reminder commands without
an event show an ephemeral string select of the authorized candidates, because
organizers should not need to retype a command to resolve that ambiguity. Menus page
at 25 options with codec-validated navigation actions, preserving access to every
candidate within Discord's select limits. Choosing an event or turning a page
recomputes authorization, guild binding and open-event eligibility.

Slash commands create ephemeral Components V2 messages (response type 4). Reception
buttons, reminder confirmation and event-select/page callbacks replace their source
message (UPDATE_MESSAGE/type 7), preventing a stack of cards at reception. Updates
set only IS_COMPONENTS_V2 and retain the source message's existing ephemeral
visibility; they replace the complete components list, so confirmation removes its
button. Current authorization and domain idempotency still apply on every click,
including stale/repeated clicks. Errors from valid reception callbacks also replace
the current card with a localized notice, removing stale controls. The reception number occupies its
own heading above the name so staff can read it aloud quickly.

A reminder preview stores its audience and state/locale counts in an audit record.
Confirmation is actor-bound, expires at 15 minutes, and rechecks organizer access and
current unpaid status. Confirmation itself is audited in the same write as the notify
jobs, making repeated confirmation idempotent. Each campaign has its own delivery identifier,
so a later deliberate reminder is not suppressed by an older successful delivery.
Reachability remains grouped by notification kind, so a successful later reminder
clears an older reminder failure.
Delivery rechecks unpaid attendance, uses the participant's stored locale, and retains
the existing DM spacing/fallback behavior. There is no periodic payment reminder.

Organization disclosure stores only explicit organizer input. It is validated before
saving, and paid publication checks completeness in the same transaction as publication.
Converting a published free event to the event-level paid contract also checks it.
Existing published events are not silently unpublished. The public page is noindex and
labels its contents as organizer-provided information; it makes no compliance claim.
Offline rosters expose only the requested reception columns, in numeric order, and use
private/no-store responses and formula-safe CSV cells.

The optional Guild Scheduled Event is another projection of the event, reconciled by
the existing `panel.refresh` outbox job. It waits for a stored panel so its description
can link to that message. Creating it requires organization organizer access, current
guild-management authority, and both requested bot event permissions. A durable creation
intent is saved before POST. Only a retry of that intent can recover an exact description
and name owned by the bot creator; ambiguous matches stop. Ordinary matching names are
never adopted. A private venue remains TBA in the public Discord event. Disabling the
projection has an inline confirmation because Discord cancellation is terminal; the
application event's cancellation also queues that cancellation. Discord forbids
ACTIVE-to-CANCELED transitions, so an already-started owned projection is deleted
instead; completed/cancelled/deleted projections are treated as terminal on retry. Guild rebinding waits
until an existing projection is disabled and reconciled, preserving ownership history.

References: Discord's [Scheduled Event resource](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild-scheduled-event.mdx)
and [permissions](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx),
[interaction response types](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-response-object),
and [string selects](https://docs.discord.com/developers/components/reference#string-select).

The load rehearsal measures actual signed HTTP callbacks, including signature verification.
Form-free joins and submitted joins first acknowledge ephemerally, then replace that
reply with the complete result. At most one deferred task starts per event-loop turn,
so a burst of admission work cannot monopolize the callback loop. Form-opening joins
remain immediate because Discord cannot open a modal after deferral. The test measures
both ACK p99 and completion of all final messages, and verifies every seat, waitlist
result and number. Paid check-ins settle held seats before role-drain assertions because
held admission intentionally does not grant the confirmed participant role. The drain
uses a simulated one-second worker poll with the existing one-second DM spacing, and
asserts that JSON-only 429 retry_after values are respected.
