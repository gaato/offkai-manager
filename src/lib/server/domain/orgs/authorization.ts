import { and, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '$lib/server/db/client';
import { organizationMemberships, organizations } from '$lib/server/db/schema';
import {
  capabilitiesForRole,
  roleAtLeast,
  type OrganizationCapabilities,
  type OrganizationRole
} from '$lib/shared/organization';
import { OrganizationError } from './errors';

export interface AuthorizedOrganization {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  capabilities: OrganizationCapabilities;
  suspendedAt: Date | null;
}

export async function authorizeOrganizationRole(
  tx: DatabaseTransaction,
  organizationId: string,
  actorUserId: string,
  minimumRole: OrganizationRole,
  lockOrganization = false,
  allowSuspended = false
): Promise<AuthorizedOrganization> {
  const organizationQuery = tx
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      suspendedAt: organizations.suspendedAt
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const organizationRows = lockOrganization
    ? await organizationQuery.for('update')
    : await organizationQuery;
  const organization = organizationRows[0];
  if (!organization) throw new OrganizationError('not_found', 'organization not found');
  if (organization.suspendedAt && !allowSuspended) {
    throw new OrganizationError('forbidden', 'organization is suspended');
  }

  const membershipRows = await tx
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, actorUserId),
        eq(organizationMemberships.status, 'active')
      )
    )
    .limit(1);
  const role = membershipRows[0]?.role as OrganizationRole | undefined;
  if (!role || !roleAtLeast(role, minimumRole)) {
    throw new OrganizationError('forbidden', 'insufficient organization role');
  }
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    role,
    capabilities: capabilitiesForRole(role),
    suspendedAt: organization.suspendedAt
  };
}
