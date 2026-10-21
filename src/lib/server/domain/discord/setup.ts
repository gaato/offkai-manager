import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { read, write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import {
  discordLayoutResources,
  eventDiscordIntegrations,
  events,
  externalAccounts
} from '$lib/server/db/schema';
import { systemClock, type Clock } from '$lib/server/clock';
import { appendAudit } from '$lib/server/domain/audit';
import { authorizeOrganizationRole } from '$lib/server/domain/orgs';
import { DiscordSettingsError } from './settings';
import type { DiscordSetupGateway, GuildResources } from './resources';
import {
  featurePermissions,
  guildPermissions,
  hasPermissions,
  layoutPermissions
} from './permissions';
import {
  layoutChannelInput,
  layoutKinds,
  planLayout,
  desiredLayout,
  type LayoutKind,
  type LayoutResource
} from './layout';
import { enqueueExistingPanelRefresh } from './outbox';

export class DiscordLayoutError extends Error {
  constructor(readonly code: 'permissions' | 'preview_changed' | 'busy' | 'unavailable') {
    super(code);
  }
}
function authorize(tx: DatabaseTransaction, actorUserId: string, eventId: string, mutate: boolean) {
  const event = tx.select().from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new DiscordSettingsError('not_found', 'event not found');
  authorizeOrganizationRole(
    tx,
    event.organizationId,
    actorUserId,
    mutate ? 'organizer' : 'viewer',
    !mutate
  );
  if (mutate && event.archivedAt) throw new DiscordSettingsError('forbidden', 'event is archived');
  const settings = tx
    .select()
    .from(eventDiscordIntegrations)
    .where(eq(eventDiscordIntegrations.eventId, eventId))
    .get();
  return { event, settings };
}
function existingResources(
  tx: DatabaseTransaction,
  eventId: string,
  resources: GuildResources
): LayoutResource[] {
  const rows = tx
    .select()
    .from(discordLayoutResources)
    .where(
      and(
        eq(discordLayoutResources.eventId, eventId),
        eq(discordLayoutResources.guildId, resources.guildId),
        isNull(discordLayoutResources.retiredAt)
      )
    )
    .orderBy(asc(discordLayoutResources.kind))
    .all();
  const existing = rows.flatMap((row): LayoutResource[] => {
    if (!layoutKinds.includes(row.kind as LayoutKind)) return [];
    const role = ['participant', 'paid', 'staff'].includes(row.kind);
    const candidates = role
      ? resources.roles.filter((item) => !item.managed)
      : resources.channels.filter((item) => item.type === (row.kind === 'category' ? 4 : 0));
    if (row.discordId)
      return candidates.some((item) => item.id === row.discordId)
        ? [{ kind: row.kind as LayoutKind, discordId: row.discordId }]
        : [];
    // Only a durable pending intent may recover by its unique event-scoped name. Ordinary name matches are never adopted.
    const matches = candidates.filter((item) => item.name === row.creationName);
    if (matches.length > 1) throw new DiscordLayoutError('unavailable');
    return matches.length === 1 ? [{ kind: row.kind as LayoutKind, discordId: matches[0].id }] : [];
  });
  // A missing access role requires new owned channels: old overwrites still reference the removed role.
  // Leave the old channels untouched, and show the replacement creates explicitly in the preview.
  const accessRolesPresent = ['participant', 'staff'].every((kind) =>
    existing.some((item) => item.kind === kind)
  );
  const categoryPresent = existing.some((item) => item.kind === 'category');
  return existing.filter(
    (item) =>
      ['participant', 'paid', 'staff'].includes(item.kind) ||
      (accessRolesPresent && (item.kind === 'category' || categoryPresent))
  );
}
function preview(tx: DatabaseTransaction, eventId: string, resources: GuildResources) {
  const existing = existingResources(tx, eventId, resources).map((item) => ({
    ...item,
    name:
      [...resources.roles, ...resources.channels].find((resource) => resource.id === item.discordId)
        ?.name ?? item.discordId
  }));
  const rows = tx
    .select()
    .from(discordLayoutResources)
    .where(
      and(
        eq(discordLayoutResources.eventId, eventId),
        eq(discordLayoutResources.guildId, resources.guildId),
        isNull(discordLayoutResources.retiredAt)
      )
    )
    .all();
  const steps = planLayout(desiredLayout(eventId), existing).map((step) => {
    const row = rows.find((item) => item.kind === step.kind);
    return {
      ...step,
      name: row
        ? row.discordId
          ? `${step.name}-${row.id.slice(0, 8)}`
          : row.creationName
        : step.name
    };
  });
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ guildId: resources.guildId, existing, steps }))
    .digest('hex');
  return { existing, steps, fingerprint };
}
export async function getDiscordSetup(
  client: DatabaseClient,
  gateway: DiscordSetupGateway,
  actorUserId: string,
  eventId: string,
  clock: Clock = systemClock
) {
  const { settings } = read(client, (tx) => authorize(tx, actorUserId, eventId, false));
  const resources = settings?.guildId ? await gateway.getGuildResources(settings.guildId) : null;
  const guildNameSnapshot = resources
    ? await gateway.getGuildName(resources.guildId)
    : (settings?.guildNameSnapshot ?? '');
  if (resources && settings && guildNameSnapshot !== settings.guildNameSnapshot) {
    write(client, (tx) => {
      const current = authorize(tx, actorUserId, eventId, false).settings;
      if (current?.guildId !== resources.guildId || current.guildNameSnapshot === guildNameSnapshot)
        return;
      tx.update(eventDiscordIntegrations)
        .set({ guildNameSnapshot, updatedAt: clock.now() })
        .where(eq(eventDiscordIntegrations.id, current.id))
        .run();
      appendAudit(
        tx,
        {
          actorUserId,
          eventId,
          action: 'discord.guild_name_refresh',
          targetType: 'event_discord_integration',
          targetId: current.id,
          before: { guildNameSnapshot: current.guildNameSnapshot },
          after: { guildNameSnapshot }
        },
        clock
      );
    });
  }
  return {
    guildNameSnapshot,
    resources,
    missing: resources ? featurePermissions(resources, settings ?? {}) : null,
    layout: resources ? read(client, (tx) => preview(tx, eventId, resources)) : null
  };
}
/** Each REST result is persisted with its audit before the next REST call, so errors can resume. */
export async function applyDiscordLayout(
  client: DatabaseClient,
  gateway: DiscordSetupGateway,
  actorUserId: string,
  eventId: string,
  fingerprint: string,
  clock: Clock = systemClock
) {
  const { settings, providerUserId } = read(client, (tx) => {
    const authorized = authorize(tx, actorUserId, eventId, true);
    const account = tx
      .select({ providerUserId: externalAccounts.providerUserId })
      .from(externalAccounts)
      .where(
        and(eq(externalAccounts.userId, actorUserId), eq(externalAccounts.provider, 'discord'))
      )
      .get();
    return { ...authorized, providerUserId: account?.providerUserId };
  });
  if (!settings?.guildId) throw new DiscordLayoutError('unavailable');
  const resources = await gateway.getGuildResources(settings.guildId);
  if (!resources) throw new DiscordLayoutError('unavailable');
  if (!providerUserId || !(await gateway.canManageGuild(settings.guildId, providerUserId)))
    throw new DiscordSettingsError(
      'guild_not_managed',
      'the actor cannot manage the Discord guild'
    );
  if (
    !hasPermissions(
      guildPermissions(resources.guildId, resources.botRoleIds, resources.roles),
      layoutPermissions
    )
  )
    throw new DiscordLayoutError('permissions');
  const claim = randomUUID();
  const plan = write(client, (tx) => {
    const current = authorize(tx, actorUserId, eventId, true).settings;
    if (!current || current.guildId !== settings.guildId)
      throw new DiscordLayoutError('preview_changed');
    // A bounded lease serializes double submissions and allows recovery after a terminated process.
    if (
      current.layoutClaim &&
      current.layoutClaimedAt &&
      clock.now().getTime() - current.layoutClaimedAt.getTime() < 15 * 60_000
    )
      throw new DiscordLayoutError('busy');
    const plan = preview(tx, eventId, resources);
    if (plan.fingerprint !== fingerprint) throw new DiscordLayoutError('preview_changed');
    tx.update(eventDiscordIntegrations)
      .set({ layoutClaim: claim, layoutClaimedAt: clock.now() })
      .where(eq(eventDiscordIntegrations.id, settings.id))
      .run();
    for (const resource of plan.existing) {
      tx.update(discordLayoutResources)
        .set({ discordId: resource.discordId })
        .where(
          and(
            eq(discordLayoutResources.eventId, eventId),
            eq(discordLayoutResources.guildId, settings.guildId),
            eq(discordLayoutResources.kind, resource.kind),
            isNull(discordLayoutResources.retiredAt)
          )
        )
        .run();
    }
    // Reserve the entire plan before REST. This keeps dependent replacements pending across a failure after role recreation.
    for (const step of plan.steps) {
      const previous = tx
        .select()
        .from(discordLayoutResources)
        .where(
          and(
            eq(discordLayoutResources.eventId, eventId),
            eq(discordLayoutResources.guildId, settings.guildId),
            eq(discordLayoutResources.kind, step.kind),
            isNull(discordLayoutResources.retiredAt)
          )
        )
        .get();
      if (previous?.discordId)
        tx.update(discordLayoutResources)
          .set({ retiredAt: clock.now() })
          .where(eq(discordLayoutResources.id, previous.id))
          .run();
      if (!previous || previous.discordId)
        tx.insert(discordLayoutResources)
          .values({
            eventId,
            guildId: settings.guildId,
            kind: step.kind,
            discordId: '',
            creationName: step.name,
            createdAt: clock.now()
          })
          .run();
    }
    appendAudit(
      tx,
      {
        actorUserId,
        eventId,
        action: 'discord.layout_begin',
        targetType: 'event',
        targetId: eventId
      },
      clock
    );
    return plan;
  });
  const ids: Partial<Record<LayoutKind, string>> = Object.fromEntries(
    plan.existing.map((item) => [item.kind, item.discordId])
  );
  const checkClaim = (tx: DatabaseTransaction) => {
    const current = authorize(tx, actorUserId, eventId, true).settings;
    if (current?.guildId !== settings.guildId || current.layoutClaim !== claim)
      throw new DiscordLayoutError('preview_changed');
  };
  try {
    for (const step of plan.steps) {
      const intentId = write(client, (tx) => {
        checkClaim(tx);
        tx.update(eventDiscordIntegrations)
          .set({ layoutClaimedAt: clock.now() })
          .where(eq(eventDiscordIntegrations.id, settings.id))
          .run();
        appendAudit(
          tx,
          {
            actorUserId,
            eventId,
            action: 'discord.layout_step',
            targetType: 'event',
            targetId: eventId,
            after: { kind: step.kind }
          },
          clock
        );
        const intent = tx
          .select()
          .from(discordLayoutResources)
          .where(
            and(
              eq(discordLayoutResources.eventId, eventId),
              eq(discordLayoutResources.guildId, settings.guildId),
              eq(discordLayoutResources.kind, step.kind),
              isNull(discordLayoutResources.retiredAt)
            )
          )
          .get();
        if (!intent) throw new DiscordLayoutError('preview_changed');
        return intent.id;
      });
      const created =
        step.type === 'role'
          ? await gateway.createRole(settings.guildId, step.name)
          : await gateway.createChannel(
              settings.guildId,
              layoutChannelInput(step, settings.guildId, resources.botId, ids)
            );
      // Record ownership even if the event was rebound while the request was in flight. Never adopt or delete unrelated resources.
      write(client, (tx) => {
        tx.update(discordLayoutResources)
          .set({ discordId: created.id, createdAt: clock.now() })
          .where(eq(discordLayoutResources.id, intentId))
          .run();
        appendAudit(
          tx,
          {
            actorUserId,
            eventId,
            action: 'discord.layout_created',
            targetType: 'discord_layout_resource',
            targetId: created.id,
            after: { kind: step.kind, guildId: settings.guildId }
          },
          clock
        );
      });
      ids[step.kind] = created.id;
    }
    write(client, (tx) => {
      checkClaim(tx);
      tx.update(eventDiscordIntegrations)
        .set({
          roleId: ids.participant,
          paidRoleId: ids.paid,
          staffRoleId: ids.staff,
          announcementChannelId: ids.announcements,
          questionsChannelId: ids.questions,
          notificationChannelId: ids.notifications,
          staffChannelId: ids.staffLog,
          updatedAt: clock.now()
        })
        .where(eq(eventDiscordIntegrations.id, settings.id))
        .run();
      appendAudit(
        tx,
        {
          actorUserId,
          eventId,
          action: 'discord.layout_applied',
          targetType: 'event',
          targetId: eventId,
          after: ids
        },
        clock
      );
      enqueueExistingPanelRefresh(tx, eventId, clock);
    });
  } finally {
    write(client, (tx) => {
      tx.update(eventDiscordIntegrations)
        .set({ layoutClaim: '', layoutClaimedAt: null })
        .where(
          and(
            eq(eventDiscordIntegrations.id, settings.id),
            eq(eventDiscordIntegrations.layoutClaim, claim)
          )
        )
        .run();
      appendAudit(
        tx,
        {
          actorUserId,
          eventId,
          action: 'discord.layout_end',
          targetType: 'event',
          targetId: eventId
        },
        clock
      );
    });
  }
}
