import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getDisclosure, saveDisclosure } from '$lib/server/domain/orgs/disclosure';
import { OrganizationError } from '$lib/server/domain/orgs/errors';
import { disclosureSchema } from '$lib/shared/disclosure';
export const load: PageServerLoad = async (event) => {
  const user = requireSession(event);
  const id = z.uuid().safeParse(event.params.orgId);
  if (!id.success) throw error(404);
  try {
    const data = getDisclosure(getDatabaseClient(getConfig()), id.data, user.userId);
    return { form: await superValidate(data ?? undefined, zod4(disclosureSchema(event.locals.t))) };
  } catch (cause) {
    if (cause instanceof OrganizationError) throw error(403);
    throw cause;
  }
};
export const actions: Actions = {
  save: async (event) => {
    const user = requireSession(event);
    const id = z.uuid().safeParse(event.params.orgId);
    if (!id.success) throw error(404);
    const form = await superValidate(event, zod4(disclosureSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    try {
      saveDisclosure(getDatabaseClient(getConfig()), id.data, user.userId, form.data);
      return message(form, event.locals.t('legal.saved'));
    } catch (cause) {
      if (cause instanceof OrganizationError)
        return message(form, event.locals.t('event.error_forbidden'), { status: 403 });
      throw cause;
    }
  }
};
