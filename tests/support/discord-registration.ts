import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { eventDiscordIntegrations, events } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { createOrganization } from '$lib/server/domain/orgs';
import {
  createEvent,
  publishEvent,
  upsertField,
  type UpsertFormFieldInput
} from '$lib/server/domain/events';
import { fixedClock } from '../database';
import { actor } from './interactions';

export const guildId = '400000000000000001';
export const roleId = '600000000000000002';
export async function discordEvent(
  client: DatabaseClient,
  options: {
    mode?: 'auto_confirm' | 'approval';
    capacity?: number | null;
    fields?: Partial<UpsertFormFieldInput>[];
    guild?: string;
  } = {}
) {
  const owner = await upsertDiscordIdentity(
    client,
    {
      providerUserId: actor.id,
      username: actor.username,
      displayName: 'Organizer',
      avatarUrl: ''
    },
    fixedClock
  );
  const org = await createOrganization(
    client,
    { actorUserId: owner.userId, name: `Test ${crypto.randomUUID()}` },
    fixedClock
  );
  const draft = await createEvent(
    client,
    {
      actorUserId: owner.userId,
      organizationId: org.id,
      title: 'Discord meetup',
      startsAt: '2027-01-01T12:00',
      timeZone: 'Asia/Tokyo',
      capacity: options.capacity ?? 10,
      registrationMode: options.mode ?? 'auto_confirm'
    },
    undefined,
    fixedClock
  );
  const fields = [];
  for (const [i, field] of (options.fields ?? []).entries()) {
    fields.push(
      await upsertField(
        client,
        {
          actorUserId: owner.userId,
          eventId: draft.id,
          label: `Question ${i + 1}`,
          type: 'text',
          required: true,
          ...field
        },
        fixedClock
      )
    );
  }
  client.db
    .insert(eventDiscordIntegrations)
    .values({
      eventId: draft.id,
      guildId: options.guild ?? guildId,
      roleId,
      createdAt: fixedClock.now(),
      updatedAt: fixedClock.now()
    })
    .run();
  client.db
    .update(events)
    .set({
      registrationOpensAt: new Date('2026-01-01T00:00:00Z'),
      registrationClosesAt: new Date('2027-01-01T00:00:00Z'),
      cancellationPolicy: 'Contact the organizer if plans change.'
    })
    .where(eq(events.id, draft.id))
    .run();
  const event = await publishEvent(
    client,
    { actorUserId: owner.userId, eventId: draft.id },
    fixedClock
  );
  return { event, org, owner, fields };
}
