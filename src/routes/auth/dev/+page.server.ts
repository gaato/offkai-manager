import { error, redirect } from '@sveltejs/kit';
import { fail, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { isSecureRequest, setSessionCookie, signSession } from '$lib/server/auth/session';
import { safeReturnTo } from '$lib/server/auth/return-to';
import { getDatabaseClient } from '$lib/server/db/client';
import { upsertDiscordIdentity } from '$lib/server/domain/auth/discord';

function schema(t: App.Locals['t']) {
  return z.object({
    discordUserId: z
      .string()
      .trim()
      .regex(/^\d{17,20}$/, t('dev.validation_discord_id')),
    username: z
      .string()
      .trim()
      .min(1, t('dev.validation_required'))
      .max(128, t('dev.validation_too_long', { max: 128 })),
    displayName: z
      .string()
      .trim()
      .min(1, t('dev.validation_required'))
      .max(128, t('dev.validation_too_long', { max: 128 })),
    platformAdmin: z.boolean().default(false),
    returnTo: z.string().max(2048).default('/app')
  });
}

function ensureEnabled(): void {
  if (!getConfig().auth.devBypass) throw error(404);
}

export const load: PageServerLoad = async ({ locals, url }) => {
  ensureEnabled();
  return {
    form: await superValidate(
      { returnTo: safeReturnTo(url.searchParams.get('return_to')) },
      zod4(schema(locals.t))
    )
  };
};

export const actions: Actions = {
  signIn: async (event) => {
    ensureEnabled();
    const form = await superValidate(event, zod4(schema(event.locals.t)));
    if (!form.valid) return fail(400, { form });

    const config = getConfig();
    const linked = config.database.path
      ? await upsertDiscordIdentity(getDatabaseClient(config), {
          providerUserId: form.data.discordUserId,
          username: form.data.username,
          displayName: form.data.displayName,
          avatarUrl: ''
        })
      : {
          userId: form.data.discordUserId,
          displayName: form.data.displayName,
          suspended: false
        };
    if (linked.suspended) throw error(403, event.locals.t('auth.suspended'));
    const value = signSession(
      {
        userId: linked.userId,
        displayName: linked.displayName,
        platformAdmin: form.data.platformAdmin
      },
      config.auth.sessionSecret
    );
    setSessionCookie(event.cookies, value, isSecureRequest(event));
    throw redirect(303, safeReturnTo(form.data.returnTo));
  }
};
