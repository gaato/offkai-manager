import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDatabase, fixedClock } from '../database';
import { write, type DatabaseClient } from '$lib/server/db/client';
import { auditLogs, organizations, organizationMemberships, users } from '$lib/server/db/schema';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';
import { createOrganization, ensurePersonalOrganization } from '$lib/server/domain/orgs';

describe('personal organizations', () => {
  let client: DatabaseClient;
  beforeEach(() => {
    client = testDatabase();
  });
  afterEach(() => {
    client.db.$client.close();
  });
  async function user(id = '200000000000000001') {
    return upsertDiscordIdentity(
      client,
      { providerUserId: id, username: 'owner', displayName: 'Owner', avatarUrl: '' },
      fixedClock
    );
  }
  it('calling twice concurrently creates one owner membership and one audit row', async () => {
    const owner = await user();
    const [first, second] = await Promise.all([
      ensurePersonalOrganization(client, owner, fixedClock),
      ensurePersonalOrganization(client, owner, fixedClock)
    ]);
    expect(second.id).toBe(first.id);
    expect(client.db.select().from(organizations).all()).toHaveLength(1);
    expect(client.db.select().from(organizationMemberships).all()).toMatchObject([
      { organizationId: first.id, userId: owner.userId, role: 'owner', status: 'active' }
    ]);
    expect(
      client.db.select().from(auditLogs).where(eq(auditLogs.action, 'organization.create')).all()
    ).toHaveLength(1);
    expect(first.createdAt).toEqual(fixedClock.now());
  });
  it('enforces one personal organization per user in SQLite', async () => {
    const owner = await user();
    await ensurePersonalOrganization(client, owner, fixedClock);
    expect(() =>
      write(client, (tx) =>
        tx
          .insert(organizations)
          .values({
            name: 'Duplicate',
            slug: 'duplicate',
            personalOwnerUserId: owner.userId
          })
          .run()
      )
    ).toThrow(/UNIQUE constraint/);
  });
  it('keeps regular organizations separate and resolves name collisions', async () => {
    const owner = await user();
    await createOrganization(client, { actorUserId: owner.userId, name: 'Owner' }, fixedClock);
    const first = await ensurePersonalOrganization(client, owner, fixedClock);
    const second = await ensurePersonalOrganization(
      client,
      await user('200000000000000002'),
      fixedClock
    );
    expect(new Set(['owner', first.slug, second.slug]).size).toBe(3);
    expect(client.db.select().from(organizations).all()).toHaveLength(3);
  });
  it('does not recreate a suspended personal organization or reenable its membership', async () => {
    const owner = await user();
    const org = await ensurePersonalOrganization(client, owner, fixedClock);
    write(client, (tx) => {
      tx.update(organizations)
        .set({ suspendedAt: fixedClock.now() })
        .where(eq(organizations.id, org.id))
        .run();
      tx.update(organizationMemberships).set({ status: 'disabled' }).run();
    });
    expect((await ensurePersonalOrganization(client, owner, fixedClock)).suspendedAt).toEqual(
      fixedClock.now()
    );
    expect(client.db.select().from(organizationMemberships).get()?.status).toBe('disabled');
  });
  it('rejects a suspended actor', async () => {
    const owner = await user();
    write(client, (tx) =>
      tx
        .update(users)
        .set({ suspendedAt: fixedClock.now() })
        .where(eq(users.id, owner.userId))
        .run()
    );
    await expect(ensurePersonalOrganization(client, owner, fixedClock)).rejects.toMatchObject({
      code: 'forbidden'
    });
    expect(client.db.select().from(organizations).all()).toHaveLength(0);
  });
});
