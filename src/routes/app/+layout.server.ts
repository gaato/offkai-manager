import type { LayoutServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { listOrganizationsForUser } from '$lib/server/domain/orgs';

export const load: LayoutServerLoad = async (event) => {
  const session = requireSession(event);
  return {
    appSession: session,
    organizations: await listOrganizationsForUser(getDatabaseClient(getConfig()), session.userId)
  };
};
