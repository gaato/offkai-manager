import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '$lib/server/db/client';
import { users } from '$lib/server/db/schema';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function isSessionUserActive(
  client: DatabaseClient,
  userId: string,
  allowMissing: boolean
): Promise<boolean> {
  if (!uuidPattern.test(userId)) return allowMissing;
  const rows = await client.db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) return allowMissing;
  return rows[0].suspendedAt === null;
}
