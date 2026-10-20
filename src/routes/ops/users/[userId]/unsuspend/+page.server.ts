import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requirePlatformAdmin } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getPlatformUser, PlatformError, setUserSuspension } from '$lib/server/domain/platform';

function requireId(value: string | undefined): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw error(404);
  return parsed.data;
}

export const load: PageServerLoad = async (event) => {
  const userId = requireId(event.params.userId);
  try {
    const detail = await getPlatformUser(getDatabaseClient(getConfig()), userId);
    if (!detail.user.suspendedAt) throw redirect(303, `/ops/users/${userId}`);
    return { user: detail.user };
  } catch (cause) {
    if (cause instanceof PlatformError && cause.code === 'not_found') throw error(404);
    throw cause;
  }
};

export const actions: Actions = {
  unsuspend: async (event) => {
    const session = requirePlatformAdmin(event);
    const userId = requireId(event.params.userId);
    try {
      await setUserSuspension(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        targetId: userId,
        suspended: false
      });
    } catch (cause) {
      if (cause instanceof PlatformError && cause.code === 'not_found') throw error(404);
      event.locals.logger.error({ err: cause }, 'unsuspend platform user failed');
      throw error(500);
    }
    throw redirect(303, `/ops/users/${userId}?unsuspended=1`);
  }
};
