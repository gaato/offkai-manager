import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { externalAccounts, users } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';

export interface DiscordIdentityInput {
  providerUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export interface LinkedDiscordUser {
  userId: string;
  displayName: string;
  suspended: boolean;
}

export async function upsertDiscordIdentity(
  client: DatabaseClient,
  identity: DiscordIdentityInput
): Promise<LinkedDiscordUser> {
  return client.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'discord:' + identity.providerUserId}, 0))`
    );
    const existing = await tx
      .select({
        accountId: externalAccounts.id,
        userId: externalAccounts.userId,
        username: externalAccounts.username,
        displayName: externalAccounts.displayName,
        avatarUrl: externalAccounts.avatarUrl,
        suspendedAt: users.suspendedAt
      })
      .from(externalAccounts)
      .innerJoin(users, eq(users.id, externalAccounts.userId))
      .where(
        and(
          eq(externalAccounts.provider, 'discord'),
          eq(externalAccounts.providerUserId, identity.providerUserId)
        )
      )
      .limit(1);

    if (existing[0]) {
      const current = existing[0];
      await tx
        .update(externalAccounts)
        .set({
          username: identity.username,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl
        })
        .where(eq(externalAccounts.id, current.accountId));
      await tx.update(users).set({ updatedAt: new Date() }).where(eq(users.id, current.userId));
      await appendAudit(tx, {
        actorUserId: current.userId,
        action: 'identity.discord_refresh',
        targetType: 'user',
        targetId: current.userId,
        before: {
          username: current.username,
          displayName: current.displayName,
          avatarUrl: current.avatarUrl
        },
        after: {
          username: identity.username,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl
        }
      });
      return {
        userId: current.userId,
        displayName: identity.displayName,
        suspended: current.suspendedAt !== null
      };
    }

    const created = await tx.insert(users).values({}).returning({ userId: users.id });
    const userId = created[0].userId;
    await tx.insert(externalAccounts).values({
      userId,
      provider: 'discord',
      providerUserId: identity.providerUserId,
      username: identity.username,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl
    });
    await appendAudit(tx, {
      actorUserId: userId,
      action: 'identity.discord_link',
      targetType: 'user',
      targetId: userId,
      after: {
        provider: 'discord',
        providerUserId: identity.providerUserId,
        username: identity.username,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl
      }
    });
    return { userId, displayName: identity.displayName, suspended: false };
  });
}
