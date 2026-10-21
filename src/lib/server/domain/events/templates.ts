import { eq } from 'drizzle-orm';
import { read, write, type DatabaseClient } from '$lib/server/db/client';
import { events } from '$lib/server/db/schema';
import { systemClock, type Clock } from '$lib/server/clock';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { appendAudit } from '$lib/server/domain/audit';
import { enqueueExistingPanelRefresh } from '$lib/server/domain/discord/outbox';
import { unknownPanelVariables } from '$lib/shared/panel-template';
import { translate } from '$lib/i18n';
import { EventError } from './errors';

export function getPanelTemplates(client: DatabaseClient, actorUserId: string, eventId: string) {
  return read(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, eventId)).get();
    if (!event) throw new EventError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'viewer', true);
    return {
      panelTemplateJa: event.panelTemplateJa || translate('ja', 'panel_template.default'),
      panelTemplateEn: event.panelTemplateEn || translate('en', 'panel_template.default'),
      reviewedAt: event.panelTemplateReviewedAt
    };
  });
}
export function updatePanelTemplates(
  client: DatabaseClient,
  input: { actorUserId: string; eventId: string; panelTemplateJa: string; panelTemplateEn: string },
  clock: Clock = systemClock
) {
  if (
    [input.panelTemplateJa, input.panelTemplateEn].some(
      (value) => value.length > 10_000 || unknownPanelVariables(value).length
    )
  )
    throw new EventError('validation', 'unknown panel template variable or template too long');
  return write(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, input.eventId)).get();
    if (!event) throw new EventError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, input.actorUserId, 'organizer');
    if (event.archivedAt) throw new EventError('illegal_transition', 'event is archived');
    const values = {
      panelTemplateJa: input.panelTemplateJa,
      panelTemplateEn: input.panelTemplateEn,
      panelTemplateReviewedAt: clock.now(),
      updatedAt: clock.now()
    };
    tx.update(events).set(values).where(eq(events.id, event.id)).run();
    appendAudit(
      tx,
      {
        actorUserId: input.actorUserId,
        eventId: event.id,
        action: 'event.panel_templates_update',
        targetType: 'event',
        targetId: event.id,
        before: { panelTemplateJa: event.panelTemplateJa, panelTemplateEn: event.panelTemplateEn },
        after: values
      },
      clock
    );
    enqueueExistingPanelRefresh(tx, event.id, clock);
  });
}
