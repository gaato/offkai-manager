import { and, count, eq, isNull } from 'drizzle-orm';
import { read, type DatabaseClient } from '$lib/server/db/client';
import {
  discordPanels,
  eventDiscordIntegrations,
  events,
  registrations,
  stripeConnectAccounts
} from '$lib/server/db/schema';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { EventError } from './errors';

export function preparationChecklist(input: {
  guildId: string;
  reviewed: boolean;
  panelPosted: boolean;
  payoutsReady?: boolean;
}) {
  return [
    ...(input.payoutsReady === undefined
      ? []
      : [{ key: 'event.setup_payouts' as const, done: input.payoutsReady, anchor: 'payouts' }]),
    {
      key: 'event.setup_linked' as const,
      done: Boolean(input.guildId),
      anchor: 'discord-settings'
    },
    { key: 'event.setup_reviewed' as const, done: input.reviewed, anchor: 'panel-templates' },
    { key: 'event.setup_posted' as const, done: input.panelPosted, anchor: 'panel-posting' }
  ];
}
export function getEventDashboard(client: DatabaseClient, actorUserId: string, eventId: string) {
  return read(client, (tx) => {
    const event = tx.select().from(events).where(eq(events.id, eventId)).get();
    if (!event) throw new EventError('not_found', 'event not found');
    authorizeOrganizationRole(tx, event.organizationId, actorUserId, 'viewer', true);
    const integration = tx
      .select()
      .from(eventDiscordIntegrations)
      .where(eq(eventDiscordIntegrations.eventId, eventId))
      .get();
    const panels = tx
      .select()
      .from(discordPanels)
      .where(
        and(
          eq(discordPanels.eventId, eventId),
          eq(discordPanels.guildId, integration?.guildId ?? ''),
          isNull(discordPanels.deletedAt)
        )
      )
      .all();
    const counts = tx
      .select({ status: registrations.status, value: count() })
      .from(registrations)
      .where(eq(registrations.eventId, eventId))
      .groupBy(registrations.status)
      .all();
    const value = (status: string) => counts.find((row) => row.status === status)?.value ?? 0;
    return {
      stats: {
        confirmed: value('confirmed'),
        waitlisted: value('waitlisted'),
        cancelled: value('cancelled')
      },
      steps: preparationChecklist({
        payoutsReady:
          event.paymentRequirement === 'none' ||
          tx
            .select()
            .from(stripeConnectAccounts)
            .where(eq(stripeConnectAccounts.organizationId, event.organizationId))
            .get()?.onboardingStatus === 'ready',
        guildId: integration?.guildId ?? '',
        reviewed: event.panelTemplateReviewedAt !== null,
        panelPosted: panels.length > 0
      })
    };
  });
}
