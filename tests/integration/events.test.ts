import { testDatabase, fixedClock } from '../database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { closeDatabase, type DatabaseClient } from '$lib/server/db/client';
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
  let client: DatabaseClient;
  let ownerId: string;
  let sequence = 0;
  beforeEach(async () => {
    client = testDatabase();
    ownerId = (
      await upsertDiscordIdentity(
        client,
        {
          providerUserId: '120000000000000001',
          username: 'event-owner',
          displayName: 'Event Owner',
          avatarUrl: ''
        },
        fixedClock
      )
    ).userId;
  });
  afterEach(async () => {
    if (client) await closeDatabase(client);
  });
  async function draft(prefix: string, slugFactory?: () => string): Promise<EventSummary> {
    sequence += 1;
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: `${prefix} ${sequence}`
      },
      fixedClock
    );
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
      slugFactory,
      fixedClock
    );
  }
  it('enforces the legal and illegal lifecycle transition matrix', async () => {
    const draftForPublish = await draft('Publish matrix');
    const published = await publishEvent(
      client,
      {
        actorUserId: ownerId,
        eventId: draftForPublish.id
      },
      fixedClock
    );
    expect(published.visibility).toBe('public');
    await expect(
      publishEvent(client, { actorUserId: ownerId, eventId: published.id }, fixedClock)
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
    const unlisted = await toggleEventUnlisted(
      client,
      {
        actorUserId: ownerId,
        eventId: published.id
      },
      fixedClock
    );
    expect(unlisted.visibility).toBe('unlisted');
    const relisted = await toggleEventUnlisted(
      client,
      {
        actorUserId: ownerId,
        eventId: unlisted.id
      },
      fixedClock
    );
    expect(relisted.visibility).toBe('public');
    const untouchedDraft = await draft('Unlist matrix');
    await expect(
      toggleEventUnlisted(client, { actorUserId: ownerId, eventId: untouchedDraft.id }, fixedClock)
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
    const states = [
      await draft('Cancel draft'),
      await publishEvent(
        client,
        {
          actorUserId: ownerId,
          eventId: (await draft('Cancel public')).id
        },
        fixedClock
      ),
      await toggleEventUnlisted(
        client,
        {
          actorUserId: ownerId,
          eventId: (
            await publishEvent(
              client,
              {
                actorUserId: ownerId,
                eventId: (await draft('Cancel unlisted')).id
              },
              fixedClock
            )
          ).id
        },
        fixedClock
      )
    ];
    for (const state of states) {
      const cancelled = await cancelEvent(
        client,
        {
          actorUserId: ownerId,
          eventId: state.id,
          reason: 'matrix coverage'
        },
        fixedClock
      );
      expect(cancelled.cancelledAt).not.toBeNull();
      const repeated = await cancelEvent(
        client,
        {
          actorUserId: ownerId,
          eventId: state.id,
          reason: 'again'
        },
        fixedClock
      );
      expect(repeated.cancelledAt).toEqual(cancelled.cancelledAt);
      const archived = await archiveEvent(
        client,
        {
          actorUserId: ownerId,
          eventId: state.id
        },
        fixedClock
      );
      expect(archived.archivedAt).not.toBeNull();
      await expect(
        archiveEvent(client, { actorUserId: ownerId, eventId: state.id }, fixedClock)
      ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
    }
    const archivedDraft = await archiveEvent(
      client,
      {
        actorUserId: ownerId,
        eventId: (await draft('Archived matrix')).id
      },
      fixedClock
    );
    await expect(
      publishEvent(client, { actorUserId: ownerId, eventId: archivedDraft.id }, fixedClock)
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
    await expect(
      cancelEvent(
        client,
        {
          actorUserId: ownerId,
          eventId: archivedDraft.id,
          reason: 'too late'
        },
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'illegal_transition' } satisfies Partial<EventError>);
  });
  it('requires a non-empty cancellation reason', async () => {
    const item = await draft('Reason required');
    await expect(
      cancelEvent(client, { actorUserId: ownerId, eventId: item.id, reason: '   ' }, fixedClock)
    ).rejects.toMatchObject({ code: 'validation' } satisfies Partial<EventError>);
    expect((await getEventAccess(client, ownerId, item.id)).event.cancelledAt).toBeNull();
  });
  it('refuses creation and mutation for a suspended organization', async () => {
    sequence += 1;
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: `Suspended events ${sequence}`
      },
      fixedClock
    );
    const item = await createEvent(
      client,
      {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: 'Before suspension',
        startsAt: '2027-09-01T18:00',
        timeZone: 'Asia/Tokyo'
      },
      undefined,
      fixedClock
    );
    client.db
      .update(organizations)
      .set({ suspendedAt: new Date('2026-10-21T00:00:00.000Z') })
      .where(eq(organizations.id, organization.id))
      .run();
    await expect(
      createEvent(
        client,
        {
          actorUserId: ownerId,
          organizationId: organization.id,
          title: 'After suspension',
          startsAt: '2027-09-02T18:00',
          timeZone: 'Asia/Tokyo'
        },
        undefined,
        fixedClock
      )
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
    await expect(
      publishEvent(client, { actorUserId: ownerId, eventId: item.id }, fixedClock)
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<OrganizationError>);
  });
  it('retries an organization-scoped slug collision', async () => {
    sequence += 1;
    const organization = await createOrganization(
      client,
      {
        actorUserId: ownerId,
        name: `Slug retry ${sequence}`
      },
      fixedClock
    );
    const input = {
      actorUserId: ownerId,
      organizationId: organization.id,
      title: 'Collision event',
      startsAt: '2027-09-01T18:00',
      timeZone: 'Asia/Tokyo'
    };
    await createEvent(client, input, () => '20270901-aaaa', fixedClock);
    let calls = 0;
    const retried = await createEvent(
      client,
      { ...input, title: 'Retried event' },
      () => {
        calls += 1;
        return calls === 1 ? '20270901-aaaa' : '20270901-bbbb';
      },
      fixedClock
    );
    expect(retried.slug).toBe('20270901-bbbb');
    expect(calls).toBe(2);
  });
  it('round-trips wall-clock settings through UTC and the configured zone', async () => {
    const item = await draft('Wall clock');
    const updated = await updateSettings(
      client,
      {
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
      },
      fixedClock
    );
    expect(updated.startsAt.toISOString()).toBe('2027-03-14T22:30:00.000Z');
    expect(updated.endsAt.toISOString()).toBe('2027-03-15T01:45:00.000Z');
    expect(formatWallClockInput(updated.startsAt, 'America/New_York')).toBe('2027-03-14T18:30');
    expect(formatWallClockInput(updated.endsAt, 'America/New_York')).toBe('2027-03-14T21:45');
    expect(updated.capacity).toBeNull();
  });
  it('appends every mutation audit in the event transaction', async () => {
    const item = await draft('Audit lifecycle');
    fixedClock.advance();
    await updateSettings(
      client,
      {
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
      },
      fixedClock
    );
    fixedClock.advance();
    await publishEvent(client, { actorUserId: ownerId, eventId: item.id }, fixedClock);
    fixedClock.advance();
    await toggleEventUnlisted(client, { actorUserId: ownerId, eventId: item.id }, fixedClock);
    fixedClock.advance();
    await cancelEvent(
      client,
      {
        actorUserId: ownerId,
        eventId: item.id,
        reason: 'audit coverage'
      },
      fixedClock
    );
    fixedClock.advance();
    await archiveEvent(client, { actorUserId: ownerId, eventId: item.id }, fixedClock);
    const logs = client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.eventId, item.id))
      .orderBy(asc(auditLogs.createdAt))
      .all();
    expect(logs.map(({ action }) => action)).toEqual([
      'event.create',
      'event.settings_update',
      'event.publish',
      'event.unlist',
      'event.cancel',
      'event.archive'
    ]);
    const listed = client.db.select().from(events).where(eq(events.id, item.id)).all();
    expect(listed[0].archivedAt).not.toBeNull();
  });
});
