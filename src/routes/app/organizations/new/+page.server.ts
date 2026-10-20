import { fail, message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  createOrganization,
  OrganizationError,
  type OrganizationSummary
} from '$lib/server/domain/orgs';

function organizationSchema(t: App.Locals['t']) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('form.validation_required'))
      .max(120, t('form.validation_too_long', { max: 120 }))
  });
}

export const load: PageServerLoad = async ({ locals }) => ({
  form: await superValidate(zod4(organizationSchema(locals.t)))
});

export const actions: Actions = {
  create: async (event) => {
    const session = requireSession(event);
    const form = await superValidate(event, zod4(organizationSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    let organization: OrganizationSummary;
    try {
      organization = await createOrganization(getDatabaseClient(getConfig()), {
        actorUserId: session.userId,
        name: form.data.name
      });
    } catch (cause) {
      event.locals.logger.error({ err: cause }, 'create organization failed');
      const key =
        cause instanceof OrganizationError && cause.code === 'validation'
          ? 'organization.error_validation'
          : 'organization.error_generic';
      return message(form, event.locals.t(key), {
        status: cause instanceof OrganizationError && cause.code === 'validation' ? 400 : 500
      });
    }
    throw redirect(303, `/app/organizations/${organization.id}`);
  }
};
