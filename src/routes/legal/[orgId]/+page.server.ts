import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getPublicOrganization } from '$lib/server/domain/orgs/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const id = z.uuid().safeParse(params.orgId);
  if (!id.success) throw error(404);
  const organization = getPublicOrganization(getDatabaseClient(getConfig()), id.data);
  if (!organization) throw error(404);
  return { organization };
};
