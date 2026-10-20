import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { loadConfig } from '$lib/server/config';
import { closeDatabase, createDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import { eventDiscordIntegrations, users } from '$lib/server/db/schema';
import {
  checkRegistrationGuildGate,
  DiscordSettingsError,
  getEventDiscordSettings,
  updateEventDiscordSettings,
  type DiscordGateway
} from '$lib/server/domain/discord';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { createEvent } from '$lib/server/domain/events';
import { createOrganization } from '$lib/server/domain/orgs';

class FakeDiscordGateway implements DiscordGateway {
  membershipChecks = 0;

  constructor(
    readonly enabled: boolean,
    private readonly member: boolean,
    private readonly managed = true
  ) {}

  async isGuildMember(): Promise<boolean> {
    this.membershipChecks += 1;
    return this.member;
  }

  async addGuildMemberRole(): Promise<void> {}
  async removeGuildMemberRole(): Promise<void> {}
  async canManageGuild(): Promise<boolean> {
    return this.managed;
  }
  async getGuildName(): Promise<string> {
    return 'Test Guild';
  }
}

describe('registration Discord guild gate', () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let ownerId: string;
  let participantId: string;
  let eventId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    client = createDatabaseClient(
      loadConfig({
        OFFKAI_DATABASE_URL: container.getConnectionUri(),
        OFFKAI_SESSION_SECRET: 'discord-gate-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'true'
      })
    );
    await runMigrations(client);
    ownerId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '120000000000000001',
        username: 'gate-owner',
        displayName: 'Gate Owner',
        avatarUrl: ''
      })
    ).userId;
    participantId = (
      await upsertDiscordIdentity(client, {
        providerUserId: '120000000000000002',
        username: 'gate-participant',
        displayName: 'Gate Participant',
        avatarUrl: ''
      })
    ).userId;
    const organization = await createOrganization(client, {
      actorUserId: ownerId,
      name: 'Discord gate matrix'
    });
    eventId = (
      await createEvent(client, {
        actorUserId: ownerId,
        organizationId: organization.id,
        title: 'Guild-gated event',
        startsAt: '2027-09-01T18:00',
        timeZone: 'Asia/Tokyo'
      })
    ).id;
  });

  afterAll(async () => {
    if (client) await closeDatabase(client);
    if (container) await container.stop();
  });

  it.each(['not_used', 'optional', 'login_required'] as const)(
    'allows the %s policy without a membership call',
    async (policy) => {
      const gateway = new FakeDiscordGateway(true, false);
      await expect(
        checkRegistrationGuildGate(client, gateway, {
          eventId,
          userId: participantId,
          policy
        })
      ).resolves.toEqual({ allowed: true, inviteUrl: '' });
      expect(gateway.membershipChecks).toBe(0);
    }
  );

  it('allows guild policy when the bot is disabled or the integration is missing', async () => {
    const disabled = new FakeDiscordGateway(false, false);
    await expect(
      checkRegistrationGuildGate(client, disabled, {
        eventId,
        userId: participantId,
        policy: 'guild_join_required'
      })
    ).resolves.toEqual({ allowed: true, inviteUrl: '' });
    const enabled = new FakeDiscordGateway(true, false);
    await expect(
      checkRegistrationGuildGate(client, enabled, {
        eventId,
        userId: participantId,
        policy: 'guild_join_required'
      })
    ).resolves.toEqual({ allowed: true, inviteUrl: '' });
    expect(disabled.membershipChecks).toBe(0);
    expect(enabled.membershipChecks).toBe(0);
  });

  it('allows members and sends non-members to the configured invitation', async () => {
    await client.db.insert(eventDiscordIntegrations).values({
      eventId,
      guildId: '120000000000000003',
      inviteUrl: 'https://discord.gg/offkai'
    });
    await expect(
      checkRegistrationGuildGate(client, new FakeDiscordGateway(true, true), {
        eventId,
        userId: participantId,
        policy: 'guild_join_required'
      })
    ).resolves.toEqual({ allowed: true, inviteUrl: 'https://discord.gg/offkai' });
    await expect(
      checkRegistrationGuildGate(client, new FakeDiscordGateway(true, false), {
        eventId,
        userId: participantId,
        policy: 'guild_join_required'
      })
    ).resolves.toEqual({ allowed: false, inviteUrl: 'https://discord.gg/offkai' });
  });

  it('denies an account without a linked Discord identity', async () => {
    const rows = await client.db.insert(users).values({}).returning({ id: users.id });
    const gateway = new FakeDiscordGateway(true, true);
    await expect(
      checkRegistrationGuildGate(client, gateway, {
        eventId,
        userId: rows[0].id,
        policy: 'guild_join_required'
      })
    ).resolves.toEqual({ allowed: false, inviteUrl: 'https://discord.gg/offkai' });
    expect(gateway.membershipChecks).toBe(0);
  });

  it('refuses to bind the shared bot to a guild the organizer does not manage', async () => {
    await client.db
      .insert(eventDiscordIntegrations)
      .values({
        eventId,
        guildId: '120000000000000003',
        guildNameSnapshot: 'Bound Guild',
        roleId: '120000000000000005'
      })
      .onConflictDoUpdate({
        target: eventDiscordIntegrations.eventId,
        set: {
          guildId: '120000000000000003',
          guildNameSnapshot: 'Bound Guild',
          roleId: '120000000000000005'
        }
      });

    await expect(
      updateEventDiscordSettings(client, new FakeDiscordGateway(true, false, false), {
        actorUserId: ownerId,
        eventId,
        policy: 'login_required',
        guildId: '120000000000000004',
        inviteUrl: 'https://discord.gg/hijacked',
        roleId: '120000000000000006'
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<DiscordSettingsError>>({ code: 'guild_not_managed' })
    );

    const settings = await getEventDiscordSettings(client, ownerId, eventId);
    expect(settings.integration?.guildId).toBe('120000000000000003');
    expect(settings.integration?.roleId).toBe('120000000000000005');
  });
});
