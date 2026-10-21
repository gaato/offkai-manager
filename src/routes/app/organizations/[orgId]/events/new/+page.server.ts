import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { createEvent, EventError, listCopySources } from '$lib/server/domain/events';
import { OrganizationError } from '$lib/server/domain/orgs';
import { formatWallClockInput } from '$lib/server/time';
import { registrationModeSchema } from '$lib/shared/event';

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function newEventSchema(t: App.Locals['t']) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('form.validation_required'))
      .max(200, t('form.validation_too_long', { max: 200 })),
    startsAt: z.string().regex(datetimeLocal, t('event.validation_datetime')),
    capacity: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : Number(value)),
      z.number().int().positive(t('event.validation_capacity')).optional()
    ),
    copyFromEventId: z.union([z.uuid(), z.literal('')]).default(''),
    registrationMode: z.union([registrationModeSchema, z.literal('')]).default('')
  });
}

export const load: PageServerLoad = async (event) => {
  const { locals } = event;
  const data = await event.parent();
  const session = requireSession(event);
  if (!data.capabilities.canManageEvent) throw error(404);
  const config = getConfig();
  return {
    copySources: listCopySources(getDatabaseClient(config), session.userId, data.organization.id),
    form: await superValidate(
      {
        title: '',
        startsAt: formatWallClockInput(Date.now() + 24 * 60 * 60 * 1_000, config.time.zone),
        registrationMode: '' as const
      },
      zod4(newEventSchema(locals.t))
    )
  };
};

export const actions: Actions = {
  create: async (event) => {
    const session = requireSession(event);
    const organizationId = z.uuid().safeParse(event.params.orgId);
    if (!organizationId.success) throw error(404);
    const form = await superValidate(event, zod4(newEventSchema(event.locals.t)));
    if (!form.valid) return fail(400, { form });
    const config = getConfig();
    let created: Awaited<ReturnType<typeof createEvent>>;
    try {
      created = await createEvent(
        getDatabaseClient(config),
        {
          actorUserId: session.userId,
          organizationId: organizationId.data,
          title: form.data.title,
          startsAt: form.data.startsAt,
          capacity: form.data.capacity,
          copyFromEventId: form.data.copyFromEventId || undefined,
          registrationMode: form.data.registrationMode || undefined,
          timeZone: config.time.zone
        },
        undefined,
        undefined,
        config.tuning
      );
    } catch (cause) {
      event.locals.logger[
        cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
      ]({ err: cause }, 'create event failed');
      const key =
        cause instanceof EventError && cause.code === 'validation'
          ? 'event.error_validation'
          : cause instanceof OrganizationError && cause.code === 'forbidden'
            ? 'event.error_forbidden'
            : 'event.error_generic';
      return message(form, event.locals.t(key), {
        status: cause instanceof EventError || cause instanceof OrganizationError ? 400 : 500
      });
    }
    throw redirect(303, `/app/events/${created.id}`);
  }
};
