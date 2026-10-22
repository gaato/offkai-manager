import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIInteractionResponse, APIPingInteraction } from 'discord-api-types/v10';
import { getConfig } from '$lib/server/config';
import { closeDatabase, getDatabaseClient, type DatabaseClient } from '$lib/server/db/client';
import { runMigrations } from '$lib/server/db/migrate';
import {
  externalAccounts,
  organizations,
  organizationMemberships,
  users
} from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { createOrganization } from '$lib/server/domain/orgs';
import { fixedClock } from '../database';
import { signingKey } from '../support/scenario-setup';
import {
  actor,
  applicationId,
  callInteraction,
  makeAutocomplete,
  makeChatInput,
  signedRequest
} from '../support/interactions';
import { POST } from '../../src/routes/interactions/+server';

const ping: APIPingInteraction = {
  type: 1,
  id: '900000000000000001',
  application_id: applicationId,
  token: 'test',
  version: 1,
  app_permissions: '0',
  entitlements: [],
  authorizing_integration_owners: {},
  attachment_size_limit: 10485760
};
describe('signed HTTP interactions', () => {
  let client: DatabaseClient;
  beforeEach(() => {
    client = getDatabaseClient(getConfig());
    runMigrations(client);
  });
  afterEach(async () => {
    await closeDatabase(client);
  });
  it('PING responds PONG without creating identities', async () => {
    const response = await callInteraction(ping, signingKey.privateKey);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
    expect(client.db.select().from(users).all()).toHaveLength(0);
  });
  it('reads the signed request body exactly once', async () => {
    const request = await signedRequest(ping, signingKey.privateKey);
    const read = vi.spyOn(request, 'text');
    const response = await POST({ request } as Parameters<typeof POST>[0]);
    expect(await response.json()).toEqual({ type: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(request.bodyUsed).toBe(true);
  });
  it('offkai web creates one shared identity and one personal owner organization, twice', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await callInteraction(makeChatInput(), signingKey.privateKey);
      expect(response.status).toBe(200);
      const result = (await response.json()) as APIInteractionResponse;
      expect(result).toMatchObject({
        type: 4,
        data: {
          flags: 64 | 32768,
          allowed_mentions: { parse: [] },
          components: [
            { type: 10 },
            { type: 1, components: [{ type: 2, style: 5, url: 'https://example.test/app' }] }
          ]
        }
      });
    }
    expect(client.db.select().from(users).all()).toHaveLength(1);
    expect(client.db.select().from(externalAccounts).all()).toHaveLength(1);
    const user = client.db.select().from(users).get()!;
    expect(client.db.select().from(organizations).all()).toMatchObject([
      { personalOwnerUserId: user.id }
    ]);
    expect(client.db.select().from(organizationMemberships).all()).toMatchObject([
      { userId: user.id, role: 'owner', status: 'active' }
    ]);
    const oauth = await upsertDiscordIdentity(
      client,
      {
        providerUserId: actor.id,
        username: actor.username,
        displayName: 'Web login',
        avatarUrl: ''
      },
      fixedClock
    );
    expect(oauth.userId).toBe(user.id);
    expect(client.db.select().from(users).all()).toHaveLength(1);
  });
  it('offkai web adds no personal organization for someone who already runs a group', async () => {
    const owner = await upsertDiscordIdentity(
      client,
      {
        providerUserId: actor.id,
        username: actor.username,
        displayName: 'Web login',
        avatarUrl: ''
      },
      fixedClock
    );
    await createOrganization(
      client,
      { actorUserId: owner.userId, name: 'Running group' },
      fixedClock
    );
    expect((await callInteraction(makeChatInput(), signingKey.privateKey)).status).toBe(200);
    expect(client.db.select().from(organizations).all()).toMatchObject([
      { name: 'Running group', personalOwnerUserId: null }
    ]);
  });
  it('reuses an OAuth identity when OAuth was first', async () => {
    const user = await upsertDiscordIdentity(
      client,
      {
        providerUserId: actor.id,
        username: actor.username,
        displayName: 'Web first',
        avatarUrl: ''
      },
      fixedClock
    );
    await callInteraction(makeChatInput(), signingKey.privateKey);
    expect(client.db.select().from(users).all()).toHaveLength(1);
    expect(client.db.select().from(organizations).get()?.personalOwnerUserId).toBe(user.userId);
  });
  it('checkin autocomplete returns no choices until check-in is implemented', async () => {
    const response = await callInteraction(makeAutocomplete('name'), signingKey.privateKey);
    expect(await response.json()).toEqual({ type: 8, data: { choices: [] } });
  });
  it('unsigned requests fail before JSON parsing', async () => {
    const response = await POST({
      request: new Request('https://example.test/interactions', {
        method: 'POST',
        body: 'invalid json'
      })
    } as Parameters<typeof POST>[0]);
    expect(response.status).toBe(401);
  });
  it('signed malformed JSON receives 400', async () => {
    expect((await callInteraction('{', signingKey.privateKey)).status).toBe(400);
  });
  it('a different application ID receives 401', async () => {
    expect(
      (
        await callInteraction(
          { ...ping, application_id: '111111111111111111' },
          signingKey.privateKey
        )
      ).status
    ).toBe(401);
  });
});
