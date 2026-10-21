# Discord FREE registration lifecycle and panels

Status: accepted implementation decisions for the FREE Discord participation milestone.

The registration core models one registration attempt as `none | applied | waitlisted |
confirmed | cancelled`. Commands are `join`, `editAnswers`, `cancel`, `promote`, plus
an organizer-only `setStatus` command. Cancelled attempts are terminal. Rejoining creates
a new attempt and reception number; it never resurrects or renumbers a cancelled row.
Confirmation describes attendance, independently of payments. The existing auto-confirm
mode waitlists overflow; approval mode leaves new registrations applied even at capacity.
Participant cancellation remains available before event start after event cancellation or
archival, preserving the existing contract. Answers may be edited until event start, even
after the registration window closes; cancelled/archived event forms are frozen.

The core emits `audit`, `syncRoles`, and `refreshPanels` data. The shell executes these in
the synchronous write transaction that changes the registration. Payment request creation
and cancellation retain their existing shell behavior; this milestone adds no payment flow.
The existing `discord.role_sync_requested` wire type is retained for role reconciliation
rather than renaming outstanding rows. New `panel.refresh` jobs deduplicate only while
pending, so changes during a PATCH can enqueue a successor. Claiming serializes jobs with
the same dedupe key. Crash recovery merges an interrupted refresh into an existing pending
successor to avoid violating the partial unique index. Role reconciliation checks current
confirmed attendance, including a new attempt after a cancellation, so older cancellation
jobs cannot remove a rejoined participant's role. Missing roles skip quietly; permanent
50013/10011 failures retain `last_error` and stop retrying. REST rate limits reschedule
against the injected clock instead of sleeping inside a batch.

`staff_channel_id` previously had no consumer. It now stores the log channel ID, exposed
as `logChannelId` in the service and form, to avoid two columns for the same destination.
`role_id` remains the participant role; new staff role and notification channel IDs are
stored but unused. No channel or role name is assumed. The runtime uses the existing
`@discordjs/rest` client with rejected rate limits for panel messages and participant roles;
the legacy injected-fetch path remains available to existing guild gateway tests.

There is one active bot panel per event and language, enforced by a partial unique index.
Repeated posting returns the existing message link. Concurrent duplicate posts are cleaned
up after the unique constraint wins. Panels are refreshed after storing a new message too,
so registrations occurring while the POST is in flight are not lost. Rebinding the guild
retires the old stored panels; their buttons still reject the mismatched guild. Panel
creation/autocomplete use published, non-cancelled, non-archived events in the current guild
and independently check active organizer/owner organization membership. A positive amount
on any non-archived collection (including a draft collection) keeps an event outside this
FREE-only interaction flow, avoiding accidental unpaid admission to a planned paid event.

Modal mapping follows the installed Discord builders and
[Discord's component reference](https://github.com/discord/discord-api-docs/blob/main/developers/components/reference.mdx):

| Existing type | Modal component | Reason |
| --- | --- | --- |
| text | Short TextInput inside Label | Existing 500-character text validation remains authoritative. |
| textarea | Paragraph TextInput inside Label | Discord input is capped at 4,000; existing 5,000-character domain data remains valid. |
| select | String Select inside Label | Supports a single option too, unlike a RadioGroup's minimum of two. |
| multiselect | CheckboxGroup inside Label | Native multiple-choice input; up to ten options. |
| checkbox | Single-option CheckboxGroup inside Label | Supports existing required-true checkbox semantics. |
| consent | Required single-option CheckboxGroup inside Label | Discord's standalone Checkbox cannot enforce required consent. |

Guild-bound forms reject a sixth active question (presets included), more than 25 single
choice options, or more than ten multiple choice options. Binding a preexisting oversized
form is rejected too. Archiving a question frees a slot. Question labels/help and choice
labels are excerpted to Discord's wire limits. Messages reserve 350 characters of the
4,000-character budget for controls/translated text. User content is Markdown-escaped and
mentions are disabled on every message.

Rejected submissions save actor/event/kind-scoped drafts. The configurable TTL is
`OFFKAI_INTERACTION_DRAFT_TTL_SECONDS` (default 3,600). Expiry is exclusive: a draft at
its expiry time cannot be read. Reads/writes remove expired rows; no draft is reused for
another actor. Retry opens saved values even if the registration window has since closed,
so the participant can review them. Joining twice, including a stale modal submission,
returns status. If an edit is submitted after cancellation, retry can start a new join
with those saved answers; it cannot revive the cancelled attempt. Edits replace active
field answers while retaining archived-field snapshots as historical evidence. If a legacy
textarea answer exceeds Discord’s 4,000-character limit, submitting its unchanged excerpt
retains the full domain-valid answer; editing another question cannot truncate it.

Functional lint applies only to domain `core/` directories. `no-let`, `immutable-data`,
and `no-loop-statements` are all enabled: this small decision function needs only branching
and immutable values, so disabling them would add no readability benefit. The inherited
clock/randomness restrictions remain in force. Service shells retain ordinary loops and
mutable builders where they make database/transport work clearer.
