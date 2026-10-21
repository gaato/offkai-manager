import { error, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requirePlatformAdmin } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getPlatformUser, PlatformError, setUserSuspension } from '$lib/server/domain/platform';

function schema(t: App.Locals['t']) {
  return z.object({
    reason: z.string().trim().min(1, t('ops.suspension.reason_required')).max(2000)
  });
}

function requireId(value: string | undefined): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw error(404);
  return parsed.data;
}

export const load: PageServerLoad = async (event) => {
  const userId = requireId(event.params.userId);
  try {
    const detail = await getPlatformUser(
      getDatabaseClient(getConfig()),
      userId,
      getConfig().tuning
    );
    if (detail.user.suspendedAt) throw redirect(303, `/ops/users/${userId}`);
    return { user: detail.user, form: await superValidate(zod4(schema(event.locals.t))) };
  } catch (cause) {
    if (cause instanceof PlatformError && cause.code === 'not_found') throw error(404);
    throw cause;
  }
};

export const actions: Actions = {
  suspend: async (event) => {
    const session = requirePlatformAdmin(event);
    const userId = requireId(event.params.userId);
    const form = await superValidate(event, zod4(schema(event.locals.t)));
    if (!form.valid)
      return message(form, event.locals.t('ops.suspension.validation'), { status: 400 });
    try {
      await setUserSuspension(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        targetId: userId,
        suspended: true,
        reason: form.data.reason
      });
    } catch (cause) {
      if (cause instanceof PlatformError && cause.code === 'not_found') throw error(404);
      if (cause instanceof PlatformError && cause.code === 'self_suspend')
        return message(form, event.locals.t('ops.suspension.self_error'), { status: 409 });
      if (cause instanceof PlatformError && cause.code === 'validation')
        return message(form, event.locals.t('ops.suspension.validation'), { status: 400 });
      event.locals.logger.error({ err: cause }, 'suspend platform user failed');
      return message(form, event.locals.t('ops.suspension.error'), { status: 500 });
    }
    throw redirect(303, `/ops/users/${userId}?suspended=1`);
  }
};
