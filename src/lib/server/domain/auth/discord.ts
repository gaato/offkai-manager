import { systemClock, type Clock } from '$lib/server/clock';
import { write } from '$lib/server/db/client';
import { and, eq } from 'drizzle-orm';
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
  identity: DiscordIdentityInput,
  clock: Clock = systemClock
): Promise<LinkedDiscordUser> {
  return write(client, (tx) => {
    const existing = tx
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
      .limit(1)
      .all();
    if (existing[0]) {
      const current = existing[0];
      tx.update(externalAccounts)
        .set({
          username: identity.username,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl
        })
        .where(eq(externalAccounts.id, current.accountId))
        .run();
      tx.update(users).set({ updatedAt: clock.now() }).where(eq(users.id, current.userId)).run();
      appendAudit(
        tx,
        {
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
        },
        clock
      );
      return {
        userId: current.userId,
        displayName: identity.displayName,
        suspended: current.suspendedAt !== null
      };
    }
    const created = tx
      .insert(users)
      .values({ createdAt: clock.now(), updatedAt: clock.now() })
      .returning({ userId: users.id })
      .all();
    const userId = created[0].userId;
    tx.insert(externalAccounts)
      .values({
        linkedAt: clock.now(),
        userId,
        provider: 'discord',
        providerUserId: identity.providerUserId,
        username: identity.username,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl
      })
      .run();
    appendAudit(
      tx,
      {
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
      },
      clock
    );
    return { userId, displayName: identity.displayName, suspended: false };
  });
}
