# A pay button on the panel and payment notices that link to it

Status: accepted. Amends the notification contract in
[ADR 0004](0004-discord-paid-registration.md) and the payment-opening behaviour in
[ADR 0006](0006-payment-schedule.md).

A staging run with real participants showed that paying was hard to find. Payment notices said
"pay from your status" without saying where that was, and the panel had no button named after
paying: the only way to Checkout was the "My status" button. The promotion notice said "a seat is
available" even when the seat was only held for 30 minutes pending payment, and a payment window
shorter than the reminder lead sent the opening notice and the reminder back to back.

## Decision

While the event's collection is open, the panel shows a Pay button next to Join. It reuses the
existing `pay` action: a newcomer is taken through joining, a released hold rejoins, and everyone
else gets the status card, whose first button is the Checkout link (or which says the fee is
paid). One step between the panel and Checkout remains unavoidable. The Checkout URL is personal,
so it cannot sit on a shared message. A Discord button cannot open a URL when pressed, because link
buttons must carry their URL when the message is sent. And creating a session starts its expiry
and may extend a hold, so it has to happen on demand. The panel is re-rendered whenever the
collection opens or changes status, so the button appears and disappears with it.

Notices that ask the participant to pay (opening, reminder, past due, hold expiring, organizer
reminders, and a promotion that leaves the seat held) carry a link button to the event's panel.
The panel is looked up at send time in the event's current server, preferring the participant's
language and otherwise the oldest live panel; without a panel the notice stays text-only. We
considered a pay button inside the DM itself. It would save a step, but participant actions are
bound to the event's server today, and loosening that for DMs widens an interaction surface for a
small gain, so we link to the panel instead. DMs and the private-thread fallback are built by one
function, so the two routes cannot diverge.

Notices state their deadline: the payment deadline in the opening notice and the reminder, the
cancellation moment in the automatic past-due notice, and the hold deadline in the hold warning.
A promotion that leaves the seat held says until when it is held; a promotion that confirms the
seat says it is confirmed. The text follows the registration's state when the notice is sent, not
a guess stored when it was queued. When payment opens less than
`OFFKAI_PAYMENT_REMINDER_LEAD_HOURS` before the deadline, the opening notice marks the reminder as
sent, because it already states the deadline.

The panel stays in the language chosen when posting it. We considered bilingual button labels and
an English button that shows the text privately. Most meetups need only Japanese, five buttons with
long labels wrap badly on phones, and replies already follow each person's language. Mixed-language
meetups can post a panel in each language.
