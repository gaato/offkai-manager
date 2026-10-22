# Scheduled pay-later collection and additional recruitment

Status: accepted.

Meetups often confirm participants months before collecting money. Collecting at registration
creates avoidable refunds, while retaining unpaid seats after the deadline prevents organizers
from reopening those seats. Some organizers also cannot set the final participation fee when
recruitment begins.

Keep `pay_later` and attach nullable payment opening, payment deadline, and additional-recruitment
opening timestamps to the event. A null payment opening preserves the original behavior: the
obligation and open collection are created at admission. When an opening is present, the deadline
is required, opening precedes the deadline, and the deadline precedes the event. Additional
recruitment may start at or after payment opening and remains open until the event starts. This
avoids adding another payment mode whose meaning would overlap `pay_later`.

Represent price state explicitly at the domain boundary as `pending | set`. Storage uses existing
collection lifecycle structure rather than a numeric sentinel: no non-archived collection is
pending, a draft collection is a set price before opening, and an open collection has materialized
obligations. This preserves bigint money invariants and keeps the freeze boundary at the first
`payment_request`, so organizers may change price and payment requirement while no participant
obligation exists.

The deterministic worker tick opens a due draft collection and backfills requests through the
same collection-opening path used by organizer actions. It sends `payment_open`, then one
`payment_due_soon` notification at the configured lead time. `payment_requests.reminded_at`
records that one-off action. After the deadline, confirmed unpaid and unchecked registrations are
cancelled and receive `payment_overdue`; paid, waived, manually paid, and checked-in attendance is
preserved. Deadline cancellation deliberately does not promote the waitlist because the freed
capacity belongs to the announced additional recruitment. A late Checkout settlement remains a
money fact and follows the existing refund-due conflict path rather than reviving attendance.

Once the scheduled collection has actually opened, new `pay_later` admissions and waitlist
promotions use an effective `pay_to_confirm` requirement without rewriting the event. They
therefore receive a held seat and immediate Checkout, while registrations before opening remain
confirmed without a request. If the opening time passes while the price is still pending, admissions
stay confirmed without a request and receive it from the opening backfill, because a held seat
without a payable collection could only expire. The
normal and additional registration windows are independent accepting intervals.

Schedule fields remain editable after obligations exist so organizers can extend a window. The
collection and unresolved request deadlines are updated with the event schedule, but changes that
put the deadline in the past are rejected. Price, payment requirement, and hold duration still
freeze after the first request. Participant panels and statuses expose the schedule and a localized
to-be-announced price; organizer dashboards and `/offkai status` warn when opening arrives without
a price.
