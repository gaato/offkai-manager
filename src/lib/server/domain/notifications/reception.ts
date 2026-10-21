import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { read, write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import {
  registrations,
  paymentRequests,
  paymentRecords,
  checkinRecords,
  auditLogs,
  outboxEvents
} from '$lib/server/db/schema';
import { authorizeDoorStaff, type DoorActor } from '../checkin/access';
import { appendAudit } from '../audit';
import type { Clock } from '$lib/server/clock';
import { OrganizationError } from '../orgs/errors';

export function unpaidRecipients(tx: DatabaseTransaction, eventId: string) {
  return tx
    .selectDistinct({
      id: registrations.id,
      state: registrations.status,
      locale: registrations.locale
    })
    .from(registrations)
    .innerJoin(paymentRequests, eq(paymentRequests.registrationId, registrations.id))
    .where(
      and(
        eq(registrations.eventId, eventId),
        inArray(registrations.status, ['held', 'confirmed']),
        inArray(paymentRequests.status, ['pending', 'payment_pending'])
      )
    )
    .all();
}
export function receptionStatus(client: DatabaseClient, eventId: string, actor: DoorActor) {
  return read(client, (tx) => {
    const event = authorizeDoorStaff(tx, eventId, actor, true);
    const rows = tx.select().from(registrations).where(eq(registrations.eventId, eventId)).all();
    const paid = tx
      .select({ amount: paymentRecords.amountMinor, currency: paymentRecords.currency })
      .from(paymentRecords)
      .innerJoin(paymentRequests, eq(paymentRequests.id, paymentRecords.paymentRequestId))
      .where(
        and(
          eq(paymentRequests.eventId, eventId),
          eq(paymentRecords.status, 'settled'),
          eq(paymentRequests.status, 'paid')
        )
      )
      .all();
    const totals = new Map<string, bigint>();
    for (const p of paid) totals.set(p.currency, (totals.get(p.currency) ?? 0n) + p.amount);
    const unreachable =
      tx
        .select({ n: sql<number>`count(distinct r.id)` })
        .from(sql`registrations r`)
        .where(
          sql`r.event_id = ${eventId} and exists(select 1 from notification_deliveries d where d.registration_id = r.id and d.result like 'failed:%' and not exists(select 1 from notification_deliveries s where s.registration_id = d.registration_id and s.kind = d.kind and s.result = 'sent'))`
        )
        .get()?.n ?? 0;
    return {
      event,
      confirmed: rows.filter((r) => r.status === 'confirmed').length,
      held: rows.filter((r) => r.status === 'held').length,
      waitlisted: rows.filter((r) => r.status === 'waitlisted').length,
      unpaid: unpaidRecipients(tx, eventId).length,
      totals: [...totals],
      checkedIn: tx
        .select()
        .from(checkinRecords)
        .where(and(eq(checkinRecords.eventId, eventId), eq(checkinRecords.status, 'checked_in')))
        .all().length,
      unreachable
    };
  });
}
const previewSchema = z.object({
  recipients: z.array(z.uuid()),
  held: z.number(),
  confirmed: z.number(),
  ja: z.number(),
  en: z.number()
});
export function previewReminder(
  client: DatabaseClient,
  eventId: string,
  actor: DoorActor,
  clock: Clock
) {
  return write(client, (tx) => {
    const event = authorizeDoorStaff(tx, eventId, actor, true);
    const recipients = unpaidRecipients(tx, eventId);
    const id = randomUUID();
    const preview = {
      recipients: recipients.map((r) => r.id),
      held: recipients.filter((r) => r.state === 'held').length,
      confirmed: recipients.filter((r) => r.state === 'confirmed').length,
      ja: recipients.filter((r) => r.locale === 'ja').length,
      en: recipients.filter((r) => r.locale === 'en').length
    };
    appendAudit(
      tx,
      {
        actorUserId: actor.actorUserId,
        eventId,
        action: 'notification.reminder_preview',
        targetType: 'reminder',
        targetId: id,
        after: preview
      },
      clock
    );
    return { id, event, ...preview };
  });
}
export function confirmReminder(
  client: DatabaseClient,
  id: string,
  actor: DoorActor,
  clock: Clock
) {
  return write(client, (tx) => {
    const row = tx
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, id), eq(auditLogs.action, 'notification.reminder_preview')))
      .get();
    if (!row?.eventId || row.actorUserId !== actor.actorUserId)
      throw new OrganizationError('forbidden', 'unknown preview');
    authorizeDoorStaff(tx, row.eventId, actor, true);
    const done = tx
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, id), eq(auditLogs.action, 'notification.reminder_confirm')))
      .get();
    if (done) return 0;
    if (clock.now().getTime() >= row.createdAt.getTime() + 15 * 60_000)
      throw new OrganizationError('forbidden', 'expired preview');
    const preview = previewSchema.parse(row.afterJson);
    const recipients = unpaidRecipients(tx, row.eventId).filter((r) =>
      preview.recipients.includes(r.id)
    );
    for (const r of recipients)
      tx.insert(outboxEvents)
        .values({
          type: 'notify',
          dedupeKey: `notify:${r.id}:reminder:${id}`,
          payloadJson: { registration_id: r.id, kind: 'payment_reminder', campaign_id: id },
          status: 'pending',
          createdAt: clock.now()
        })
        .onConflictDoNothing()
        .run();
    appendAudit(
      tx,
      {
        actorUserId: actor.actorUserId,
        eventId: row.eventId,
        action: 'notification.reminder_confirm',
        targetType: 'reminder',
        targetId: id,
        after: { count: recipients.length }
      },
      clock
    );
    return recipients.length;
  });
}
