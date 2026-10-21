import { and, asc, eq, inArray, desc } from 'drizzle-orm';
import { read, type DatabaseClient } from '$lib/server/db/client';
import {
  events,
  registrations,
  paymentRequests,
  paymentRecords,
  collectionPaymentMethods,
  checkinRecords
} from '$lib/server/db/schema';
import { authorizeOrganizationRole } from '../orgs';
import { CheckInError } from './service';
import { doorPaymentState } from './door';
export function getRoster(client: DatabaseClient, actorUserId: string, eventId: string) {
  return read(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, eventId)).get();
    if (!event) throw new CheckInError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'staff', true);
    return tx
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          inArray(registrations.status, ['confirmed', 'held'])
        )
      )
      .orderBy(asc(registrations.number))
      .all()
      .map((r) => {
        const requests = tx
          .select()
          .from(paymentRequests)
          .where(
            and(
              eq(paymentRequests.registrationId, r.id),
              inArray(paymentRequests.status, [
                'pending',
                'payment_pending',
                'paid',
                'waived',
                'refund_due'
              ])
            )
          )
          .all();
        const unpaid = requests.filter((p) => ['pending', 'payment_pending'].includes(p.status));
        const methods = requests.map((request) => {
          const record = tx
            .select()
            .from(paymentRecords)
            .where(
              and(
                eq(paymentRecords.paymentRequestId, request.id),
                eq(paymentRecords.status, 'settled')
              )
            )
            .orderBy(desc(paymentRecords.createdAt))
            .get();
          return (
            tx
              .select()
              .from(collectionPaymentMethods)
              .where(
                eq(
                  collectionPaymentMethods.id,
                  record?.collectionPaymentMethodId ?? request.collectionPaymentMethodId
                )
              )
              .get()?.label ?? ''
          );
        });
        return {
          id: r.id,
          number: r.number,
          name: r.displayNameSnapshot,
          paymentState: doorPaymentState({ requests, unpaid }),
          methods,
          checkedIn: Boolean(
            tx
              .select()
              .from(checkinRecords)
              .where(
                and(
                  eq(checkinRecords.registrationId, r.id),
                  eq(checkinRecords.status, 'checked_in')
                )
              )
              .get()
          )
        };
      });
  });
}
