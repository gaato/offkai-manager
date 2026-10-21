import { eq } from 'drizzle-orm';
import { read, type DatabaseClient } from '$lib/server/db/client';
import { organizations } from '$lib/server/db/schema';

/** Public legal disclosure exposes only the organizer's public organization name. */
export function getPublicOrganization(client: DatabaseClient, organizationId: string) {
  return read(
    client,
    (tx) =>
      tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .get() ?? null
  );
}
