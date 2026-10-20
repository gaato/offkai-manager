import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requirePlatformAdmin } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  getPlatformOrganization,
  PlatformError,
  setOrganizationSuspension
} from '$lib/server/domain/platform';

function requireId(value: string | undefined): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw error(404);
  return parsed.data;
}

export const load: PageServerLoad = async (event) => {
  const organizationId = requireId(event.params.orgId);
  try {
    const detail = await getPlatformOrganization(getDatabaseClient(getConfig()), organizationId);
    if (!detail.organization.suspendedAt)
      throw redirect(303, `/ops/organizations/${organizationId}`);
    return { organization: detail.organization };
  } catch (cause) {
    if (cause instanceof PlatformError && cause.code === 'not_found') throw error(404);
    throw cause;
  }
};

export const actions: Actions = {
  unsuspend: async (event) => {
    const session = requirePlatformAdmin(event);
    const organizationId = requireId(event.params.orgId);
    try {
      await setOrganizationSuspension(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        targetId: organizationId,
        suspended: false
      });
    } catch (cause) {
      if (cause instanceof PlatformError && cause.code === 'not_found') throw error(404);
      event.locals.logger.error({ err: cause }, 'unsuspend platform organization failed');
      throw error(500);
    }
    throw redirect(303, `/ops/organizations/${organizationId}?unsuspended=1`);
  }
};
