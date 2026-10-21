# Discord organizer preparation and safe layout ownership

Status: accepted implementation choices for organizer preparation.

Discord settings use bot-token REST snapshots. Guild role permissions are ORed with
`@everyone`; Administrator bypasses permission checks. Channel overwrites apply in Discord's
order: everyone, combined roles, member. Pickers expose only visible text/announcement
channels. Role warnings reject managed roles, `@everyone`, and equal-or-higher positions.
Equal positions are conservatively rejected to avoid depending on snowflake tie-breaks.
Missing-channel selections retain their saved ID with a warning instead of silently clearing
configuration. An inaccessible guild permits manual configuration without remote effects;
when the bot can access the guild, the existing organizer guild-management check remains. Layout application independently requires guild-management authority, including after manual binding or copying settings, to prevent creating resources in an unrelated server.
Transient REST errors remain distinguishable from a bot that cannot access the guild.
Permission repair links do not request Administrator; channel overrides and hierarchy still
need the server admin's attention. Command names and options are localized through the catalog.

The optional layout combines announcements and panel in one read-only channel, and staff and
log in one private channel. Participant/staff roles have zero guild permissions: access is
scoped through overwrites on newly created channels. The paid role is stored and unused.
The category and questions are participant/staff-visible; notifications are a read-only
parent for future private threads. Staff/log explicitly omits participant access. The bot
receives explicit member access on these new resources. Existing resources are never patched,
renamed, moved, or deleted, including resources previously created by this feature.

Ownership is event-and-guild scoped, never inferred from ordinary matching names. Resource
names include the event UUID to support recovery of a lost POST response. A durable intent
(`discord_id = ''`, `creation_name`) is written before each POST; only that pending intent can
recover an exact unique name from a fresh REST snapshot. Duplicate matches stop for review.
The whole plan is reserved before the first POST. Completed IDs are saved with audit records before the next POST. Replaced resource records are retired and retained, so every created ID remains available as ownership history. Deleted recorded resources
are recreated; missing access roles/category cause dependent channels to be replaced because
their old overwrites/parent no longer express the intended layout. Old channels are left
untouched. A preview fingerprint binds the reviewed create/reuse plan and guild; changed
plans require another preview. A database claim serializes double submissions. The 15-minute
renewable lease exceeds the configured REST timeout maximum (two minutes) and permits
recovery after process termination. No database transaction spans an await.

Template defaults are paraphrased from the JA/EN embeds supplied in
`outputs/old-panel-content.json`. They retain important rules, event details, joining,
cancellation, and conduct sections, including age/refund rules, dietary needs, smoking,
photography/streaming, belongings/waste/lost property, language consideration, and private
trades. Event details use the eight allowed variables; venue-specific arrangements, dates,
prices, ticket vendors, channel mentions, and fixed communication-language assumptions are
omitted. Joining and cancellation describe the current panel controls rather than the old
ticket workflow, because those are the actions participants can perform now. The defaults
remain editable event text, not platform policy. Only eight variables are supported. Substitutions are single-pass,
Markdown-escaped and mention-neutralized, and respect private venue visibility. Only body
text is truncated, with a localized note; state and controls retain their reserved budget.
Runtime date formatting receives OFFKAI_TIMEZONE. Template saves mark both locales reviewed
and enqueue refresh in the same transaction. Existing event mutations keep their refresh
behavior.

Copying is restricted to the same organization and includes active fields/options with fresh
IDs, event settings, both templates, and Discord destinations. The new title and start are
explicit; duration and registration-window offsets shift relative to the new start. Blank
capacity/mode inherit; explicit values override. Archived fields/options, registrations,
panels, lifecycle state, review completion, leases, and resource ownership are not copied.
Review starts incomplete so organizers check event-specific rules before posting again.

The e2e harness seeds a dedicated event and starts a loopback fake Discord REST transport.
OFFKAI_DISCORD_SETUP_API_URL may be overridden only for loopback HTTP with dev bypass, so
production setup calls cannot accidentally send bot credentials to another host. Playwright
execution remains with the caller.

References: [Discord permissions](https://docs.discord.com/developers/topics/permissions),
[Guild REST resources](https://docs.discord.com/developers/resources/guild).
