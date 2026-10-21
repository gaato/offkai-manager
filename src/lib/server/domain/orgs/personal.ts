import { eq } from 'drizzle-orm';
import { systemClock, type Clock } from '$lib/server/clock';
import { write, type DatabaseClient } from '$lib/server/db/client';
import { organizations, organizationMemberships, users } from '$lib/server/db/schema';
import { appendAudit } from '$lib/server/domain/audit';
import type { LinkedDiscordUser } from '$lib/server/domain/auth/discord';
import { OrganizationError } from './errors';
import { availableOrganizationSlug } from './slug';

export async function ensurePersonalOrganization(
  client: DatabaseClient,
  user: Pick<LinkedDiscordUser, 'userId' | 'displayName'>,
  clock: Clock = systemClock
) {
  return write(client, (tx) => {
    const actor = tx.select().from(users).where(eq(users.id, user.userId)).get();
    if (!actor) throw new OrganizationError('not_found', 'actor user not found');
    if (actor.suspendedAt) throw new OrganizationError('forbidden', 'actor user is suspended');
    const existing = tx
      .select()
      .from(organizations)
      .where(eq(organizations.personalOwnerUserId, user.userId))
      .get();
    // Never restore disabled membership or a suspended organization as a side effect.
    if (existing) return existing;
    const name = (user.displayName.trim() || user.userId).slice(0, 120);
    const slugs = tx.select({ slug: organizations.slug }).from(organizations).all();
    const organization = tx
      .insert(organizations)
      .values({
        personalOwnerUserId: user.userId,
        name,
        slug: availableOrganizationSlug(name, new Set(slugs.map((row) => row.slug))),
        createdAt: clock.now(),
        updatedAt: clock.now()
      })
      .returning()
      .get();
    tx.insert(organizationMemberships)
      .values({
        organizationId: organization.id,
        userId: user.userId,
        role: 'owner',
        status: 'active',
        createdAt: clock.now(),
        updatedAt: clock.now(),
        joinedAt: clock.now()
      })
      .run();
    appendAudit(
      tx,
      {
        actorUserId: user.userId,
        action: 'organization.create',
        targetType: 'organization',
        targetId: organization.id,
        after: { name, slug: organization.slug, personalOwnerUserId: user.userId }
      },
      clock
    );
    return organization;
  });
}
