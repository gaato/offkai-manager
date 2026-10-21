import { eq } from 'drizzle-orm';
import { read, write, type DatabaseClient, type DatabaseTransaction } from '$lib/server/db/client';
import { organizations } from '$lib/server/db/schema';
import { disclosureSchema, type Disclosure } from '$lib/shared/disclosure';
import { translator } from '$lib/i18n';
import { authorizeOrganizationRole } from './authorization';
import { appendAudit } from '../audit';
import { systemClock, type Clock } from '$lib/server/clock';
export function organizationDisclosure(
  tx: DatabaseTransaction,
  organizationId: string
): Disclosure | null {
  const raw = tx
    .select({ raw: organizations.disclosureJson })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .get()?.raw;
  const parsed = disclosureSchema(translator('en')).safeParse(raw);
  return parsed.success ? parsed.data : null;
}
export function getDisclosure(client: DatabaseClient, organizationId: string, actorUserId: string) {
  return read(client, (tx) => {
    authorizeOrganizationRole(tx, organizationId, actorUserId, 'organizer', true);
    return organizationDisclosure(tx, organizationId);
  });
}
export function saveDisclosure(
  client: DatabaseClient,
  organizationId: string,
  actorUserId: string,
  input: Disclosure,
  clock: Clock = systemClock
) {
  const data = disclosureSchema(translator('en')).parse(input);
  return write(client, (tx) => {
    authorizeOrganizationRole(tx, organizationId, actorUserId, 'organizer');
    tx.update(organizations)
      .set({ disclosureJson: data, updatedAt: clock.now() })
      .where(eq(organizations.id, organizationId))
      .run();
    appendAudit(
      tx,
      {
        actorUserId,
        action: 'organization.disclosure',
        targetType: 'organization',
        targetId: organizationId,
        after: { complete: true }
      },
      clock
    );
  });
}
