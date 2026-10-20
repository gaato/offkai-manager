import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { auditLogs, events, organizations } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import {
  archiveEvent,
  cancelEvent,
  createEvent,
  EventError,
  getEventAccess,
  publishEvent,
  toggleEventUnlisted,
  updateSettings,
  type EventSummary
} from '$lib/server/domain/events';
import { createOrganization, OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClockInput } from '$lib/server/time';

describe('event domain', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'event-integration-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    ownerId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '120000000000000001',
        username: 'event-owner',
        displayName: 'Event Owner',
        avatarUrl: ''
      })
    ).userId;
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  async function draft(prefix: string, slugFactory?: () => string): Promise<EventSummary> {
    sequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `${prefix} ${sequence}`
    });
    return createEvent(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: `${prefix} event`,
        startsAt: '2027-09-01T18:00',
        capacity: null,
        timeZone: 'Asia/Tokyo'
      },
      slugFactory
    );
  }

  it('enforces the legal and illegal lifecycle transition matrix', async () => {
    const draftForPublish = await draft('Publish matrix');
    const published = await publishEvent(client, {
      actorUserId: ownerId,
      eventId: draftForPublish.id
    });
    expect(published.visibility).toBe('public');
    await expect(
      publishEvent(client, { actorUserId: ownerId, eventId: published.id })
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);

    const unlisted = await toggleEventUnlisted(client, {
      actorUserId: ownerId,
      eventId: published.id
    });
    expect(unlisted.visibility).toBe('unlisted');
    const relisted = await toggleEventUnlisted(client, {
      actorUserId: ownerId,
      eventId: unlisted.id
    });
    expect(relisted.visibility).toBe('public');

    const untouchedDraft = await draft('Unlist matrix');
    await expect(
      toggleEventUnlisted(client, { actorUserId: ownerId, eventId: untouchedDraft.id })
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);

    const states = [
      await draft('Cancel draft'),
      await publishEvent(client, {
        actorUserId: ownerId,
        eventId: (await draft('Cancel public')).id
      }),
      await toggleEventUnlisted(client, {
        actorUserId: ownerId,
        eventId: (
          await publishEvent(client, {
            actorUserId: ownerId,
            eventId: (await draft('Cancel unlisted')).id
          })
        ).id
      })
    ];
    for (const state of states) {
      const cancelled = await cancelEvent(client, {
        actorUserId: ownerId,
        eventId: state.id,
        reason: 'matrix coverage'
      });
      expect(cancelled.cancelledAt).not.toBeNull();
      const repeated = await cancelEvent(client, {
        actorUserId: ownerId,
        eventId: state.id,
        reason: 'again'
      });
      expect(repeated.cancelledAt).toEqual(cancelled.cancelledAt);
      const archived = await archiveEvent(client, {
        actorUserId: ownerId,
        eventId: state.id
      });
      expect(archived.archivedAt).not.toBeNull();
      await expect(
        archiveEvent(client, { actorUserId: ownerId, eventId: state.id })
      ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
    }

    const archivedDraft = await archiveEvent(client, {
      actorUserId: ownerId,
      eventId: (await draft('Archived matrix')).id
    });
    await expect(
      publishEvent(client, { actorUserId: ownerId, eventId: archivedDraft.id })
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
    await expect(
      cancelEvent(client, {
        actorUserId: ownerId,
        eventId: archivedDraft.id,
        reason: 'too late'
      })
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
  });

  it('requires a non-empty cancellation reason', async () => {
    const item = await draft('Reason required');
    await expect(
      cancelEvent(client, { actorUserId: ownerId, eventId: item.id, reason: '   ' })
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<EventError>);
    expect((await getEventAccess(client, ownerId, item.id)).event.cancelledAt).toBeNull();
  });

  it('refuses creation and mutation for a suspended organization', async () => {
    sequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `Suspended events ${sequence}`
    });
    const item = await createEvent(client, {
      actorUserId: ownerId,
      organizationId: organization.id,
      title: 'Before suspension',
      startsAt: '2027-09-01T18:00',
      timeZone: 'Asia/Tokyo'
    });
    await client.db
      .update(organizations)
      .set({ suspendedAt: new Date() })
      .where(eq(organizations.id, organization.id));
    await expect(
      createEvent(client, {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: 'After suspension',
        startsAt: '2027-09-02T18:00',
        timeZone: 'Asia/Tokyo'
      })
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
    await expect(
      publishEvent(client, { actorUserId: ownerId, eventId: item.id })
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
  });

  it('retries an organization-scoped slug collision', async () => {
    sequence += 1;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: `Slug retry ${sequence}`
    });
    const input = {
      actorUserId: ownerId,
      organizationId: organization.id,
      title: 'Collision event',
      startsAt: '2027-09-01T18:00',
      timeZone: 'Asia/Tokyo'
    };
    await createEvent(client, input, () => '20270901-aaaa');
    let calls = 0;
    const retried = await createEvent(client, { ...input, title: 'Retried event' }, () => {
      calls += 1;
      return calls === 1 ? '20270901-aaaa' : '20270901-bbbb';
    });
    expect(retried.slug).toBe('20270901-bbbb');
    expect(calls).toBe(2);
  });

  it('round-trips wall-clock settings through UTC and the configured zone', async () => {
    const item = await draft('Wall clock');
    const updated = await updateSettings(client, {
      actorUserId: ownerId,
      eventId: item.id,
      title: 'Timezone Event',
      description: 'DST-aware storage',
      startsAt: '2027-03-14T18:30',
      endsAt: '2027-03-14T21:45',
      capacity: null,
      venueName: 'Community Hall',
      venueAddress: '100 Main Street',
      venueReveal: 'confirmed',
      contact: '@host',
      cancellationPolicy: 'Contact the organizer.',
      registrationOpensAt: '2027-02-01T09:00',
      registrationClosesAt: '2027-03-14T17:00',
      registrationMode: 'approval',
      discordPolicy: 'optional',
      timeZone: 'America/New_York'
    });
    expect(updated.startsAt.toISOString()).toBe('2027-03-14T22:30:00.000Z');
    expect(updated.endsAt.toISOString()).toBe('2027-03-15T01:45:00.000Z');
    expect(formatWallClockInput(updated.startsAt, 'America/New_York')).toBe('2027-03-14T18:30');
    expect(formatWallClockInput(updated.endsAt, 'America/New_York')).toBe('2027-03-14T21:45');
    expect(updated.capacity).toBeNull();
  });

  it('appends every mutation audit in the event transaction', async () => {
    const item = await draft('Audit lifecycle');
    await updateSettings(client, {
      actorUserId: ownerId,
      eventId: item.id,
      title: item.title,
      description: '',
      startsAt: '2027-09-01T18:00',
      endsAt: '2027-09-01T21:00',
      capacity: null,
      venueName: '',
      venueAddress: '',
      venueReveal: 'public',
      contact: '',
      cancellationPolicy: '',
      registrationOpensAt: '2027-08-01T09:00',
      registrationClosesAt: '2027-09-01T17:00',
      registrationMode: 'auto_confirm',
      discordPolicy: 'not_used',
      timeZone: 'Asia/Tokyo'
    });
    await publishEvent(client, { actorUserId: ownerId, eventId: item.id });
    await toggleEventUnlisted(client, { actorUserId: ownerId, eventId: item.id });
    await cancelEvent(client, {
      actorUserId: ownerId,
      eventId: item.id,
      reason: 'audit coverage'
    });
    await archiveEvent(client, { actorUserId: ownerId, eventId: item.id });
    const logs = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, item.id))
      .orderBy(asc(auditLogs.createdAt));
    expect(logs.map(({ action }) => action)).toEqual([
      'event.create',
      'event.settings_update',
      'event.publish',
      'event.unlist',
      'event.cancel',
      'event.archive'
    ]);

    const listed = await client.db.select().from(events).where(eq(events.id, item.id));
    expect(listed[0].archivedAt).not.toBeNull();
  });
});
