# Discord organizer page and panel defaults

Status: accepted.

Discord configuration, editable panel templates, posting guidance, and the optional layout
planner live on the event's dedicated `/discord` settings page. General event settings stay
on `/settings`. The overview checklist points to the corresponding Discord sections. Event
navigation follows the organizer workflow: overview, participants, check-in, payments,
registration form, Discord, settings, activity; capability restrictions still apply.

The legacy `events.discord_policy` column and domain API remain for compatibility with
existing records and callers. Organizer forms no longer expose it or select behavior from
it. Discord saves supply the neutral `not_used` legacy value and use the guild binding as
the configuration switch. Any configured destination or role requires a guild; an entirely
empty configuration can be saved to disconnect. An invite URL is optional because
participants already interact inside Discord.

Default panel bodies contain important rules, joining, cancellation, and conduct only.
The structured header remains the single default presentation of event facts, preserving
Discord timestamps that localize for each viewer. Existing authored templates are not
rewritten. All eight variables remain available. A template line containing variables is
omitted when all its substituted values are empty or whitespace; literal lines and lines
with at least one nonempty variable remain. This applies equally to fee, venue, and every
other supported variable, so optional fields do not leave empty labels. Substitution stays
single-pass, escaped, and subject to the existing message budget.

Role pickers exclude everyone and managed roles, which can never be assigned by the bot.
Other roles remain selectable with the existing hierarchy warning. An old saved managed
or everyone role is shown as unconfigured with an explicit warning rather than offered
as a selectable role. Manual IDs remain available when the bot cannot access the guild.

Saving already verifies and stores the REST guild name. Loading Discord setup also refreshes
that cached name when the bot can access the guild. Changed names are saved with an audit
entry in one synchronous transaction, using the injected clock and rechecking the guild
binding after REST completes. Unavailable guilds retain the last known name, and an unchanged
name creates no write or audit. This metadata refresh does not edit anything in Discord.

The shared workspace shell uses a viewport-height flex column with a growing content row,
so the sidebar background reaches the viewport bottom on short pages without custom CSS.
