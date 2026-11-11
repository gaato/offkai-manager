# Organizer-chosen overdue release and a single vacancy rule

Status: accepted. Supersedes the overdue release and its waitlist handling in
[ADR 0006](0006-payment-schedule.md).

ADR 0006 cancelled unpaid attendance at the payment deadline and deliberately kept the freed seats
away from the waitlist so they could go to the announced additional recruitment. In practice
organizers differ: a large event wants unpaid seats back promptly, while a meetup among friends
would rather chase late payers than cancel them. The waitlist exception was also unfair, because
people already waiting were overtaken by new applicants, and it was the only release path that
skipped them.

Organizers now answer two independent questions per event: from when an unpaid seat may be given
up, and who gives it up. The domain type is `{ kind: 'auto' | 'manual', graceDays }`. Nobody is
released before the deadline plus `graceDays` (0–30). After that moment an automatic policy is
released by the worker, and a manual policy only by an organizer's explicit bulk action. Automatic
with 0 days keeps the previous behavior and is the default, including for existing events. We did
not expose "cancel automatically" and "organizer decides" as a bare two-way switch with a grace
period only for the automatic side: the first version did that, and review found that switching
from "automatic, 7 days" to manual after participants had been told the date let organizers cancel
them a week early. Giving both kinds the same "not before" moment closes that by construction. The
grace period must end before the event starts, otherwise nobody could ever be released.

When the deadline passes, every unpaid, unchecked participant is notified once
(`payment_requests.overdue_notified_at`) with what happens next; an immediate release needs no
separate notice. Extending the deadline clears that mark and the reminder mark, and deadline
notices carry a fresh delivery campaign, so the new deadline is announced again. Automatic releases
and the bulk action share one release function, so notification, audit and the vacancy rule cannot
drift apart. The bulk action exists only for manual policies, releases exactly the people the
confirmation page listed or nobody, and leaves out participants with an open Checkout session,
whose payment would otherwise turn into a refund.

Participants see the rule, including the "not before" moment, in the panel and status card. Once
the first payment request exists, no change may make anyone releasable earlier. The check compares
the deadline plus grace period before and after the change, so an earlier deadline counts the same
as a shorter grace period, and switching from manual back to automatic is also refused. We
considered allowing stricter changes with a warning, or with a minimum notice period. A warning
protects only the organizer from a mistake, not participants who would be cancelled the moment the
setting is saved, and the case that motivates tightening, cutting long-overdue participants, is
served by the manual policy's bulk action. The freeze boundary is the same as for the price. Adding
a deadline to a pay-later event that had none is not compared, because nothing about overdue
release had been announced.

Freed seats follow a single rule, regardless of what freed them: on auto-confirm events the oldest
waiter is promoted until the event starts, and without waiters the seat reopens to whichever
registration window is open. Every path that cancels a confirmed or held seat calls `afterSeatFreed`, which
owns these conditions, so a new cancellation path cannot forget the waitlist. An organizer moving
a participant back to the waitlist does not promote anyone, because the demoted person is usually
the oldest waiter and would be promoted straight back. Organizers who want to choose who fills a seat use
approval registration, which already leaves vacancies to them. We did not add a per-event switch
for skipping the waitlist, because it would reintroduce the unfairness above for little benefit.
Automatic promotion no longer happens after the event has started; an organizer can still confirm a
waitlisted person directly at the door.
