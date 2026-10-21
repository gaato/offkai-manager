import { and, eq, lte } from 'drizzle-orm';
import { defaultTuning, type Tuning } from '$lib/server/config';
import { systemClock, type Clock } from '$lib/server/clock';
import { write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import { appendAudit } from '$lib/server/domain/audit';
import { interactionDrafts } from '$lib/server/db/schema';

export type DraftKind = 'join' | 'edit';
export function saveInteractionDraft(
  client: DatabaseClient,
  userId: string,
  eventId: string,
  kind: DraftKind,
  payloadJson: Record<string, unknown>,
  clock: Clock = systemClock,
  tuning: Tuning = defaultTuning
): void {
  write(client, (tx) => {
    expireDrafts(tx, clock);
    const expiresAt = new Date(
      clock.now().getTime() + tuning.OFFKAI_INTERACTION_DRAFT_TTL_SECONDS * 1_000
    );
    const row = tx
      .insert(interactionDrafts)
      .values({ userId, eventId, kind, payloadJson, expiresAt })
      .onConflictDoUpdate({
        target: [interactionDrafts.userId, interactionDrafts.eventId, interactionDrafts.kind],
        set: { payloadJson, expiresAt }
      })
      .returning({ id: interactionDrafts.id })
      .get()!;
    appendAudit(
      tx,
      {
        actorUserId: userId,
        eventId,
        action: 'interaction.draft_save',
        targetType: 'interaction_draft',
        targetId: row.id,
        after: { kind, expiresAt: expiresAt.toISOString() }
      },
      clock
    );
  });
}
export function loadInteractionDraft(
  client: DatabaseClient,
  userId: string,
  eventId: string,
  kind: DraftKind,
  clock: Clock = systemClock
): Record<string, unknown> | null {
  return write(client, (tx) => {
    expireDrafts(tx, clock);
    return (
      tx
        .select()
        .from(interactionDrafts)
        .where(
          and(
            eq(interactionDrafts.userId, userId),
            eq(interactionDrafts.eventId, eventId),
            eq(interactionDrafts.kind, kind)
          )
        )
        .get()?.payloadJson ?? null
    );
  });
}
export function clearInteractionDraft(
  client: DatabaseClient,
  userId: string,
  eventId: string,
  kind: DraftKind,
  clock: Clock = systemClock
): void {
  write(client, (tx) => {
    const removed = tx
      .delete(interactionDrafts)
      .where(
        and(
          eq(interactionDrafts.userId, userId),
          eq(interactionDrafts.eventId, eventId),
          eq(interactionDrafts.kind, kind)
        )
      )
      .returning({ id: interactionDrafts.id })
      .get();
    if (removed)
      appendAudit(
        tx,
        {
          actorUserId: userId,
          eventId,
          action: 'interaction.draft_clear',
          targetType: 'interaction_draft',
          targetId: removed.id,
          before: { kind }
        },
        clock
      );
  });
}

function expireDrafts(tx: DatabaseTransaction, clock: Clock): void {
  const expired = tx
    .delete(interactionDrafts)
    .where(lte(interactionDrafts.expiresAt, clock.now()))
    .returning({
      id: interactionDrafts.id,
      userId: interactionDrafts.userId,
      eventId: interactionDrafts.eventId,
      kind: interactionDrafts.kind
    })
    .all();
  for (const row of expired)
    appendAudit(
      tx,
      {
        actorUserId: null,
        eventId: row.eventId,
        action: 'interaction.draft_expire',
        targetType: 'interaction_draft',
        targetId: row.id,
        before: { kind: row.kind }
      },
      clock
    );
}
