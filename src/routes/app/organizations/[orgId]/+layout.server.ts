import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { LayoutServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  getOrganizationForUser,
  listOrganizationMembers,
  OrganizationError
} from '$lib/server/domain/orgs';
import { capabilitiesForRole, readOnlyOrganizationCapabilities } from '$lib/shared/organization';

export const load: LayoutServerLoad = async (event) => {
  const session = requireSession(event);
  const organizationId = z.uuid().safeParse(event.params.orgId);
  if (!organizationId.success) throw error(404);
  try {
    const config = getConfig();
    const client = getDatabaseClient(config);
    const [organization, members] = await Promise.all([
      getOrganizationForUser(client, session.userId, organizationId.data),
      listOrganizationMembers(client, session.userId, organizationId.data)
    ]);
    return {
      organization,
      members,
      capabilities: organization.suspendedAt
        ? readOnlyOrganizationCapabilities()
        : capabilitiesForRole(organization.actorRole)
    };
  } catch (cause) {
    if (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code)) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'load organization workspace failed');
    throw error(500);
  }
};
