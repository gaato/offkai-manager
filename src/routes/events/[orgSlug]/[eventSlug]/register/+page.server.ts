import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { loginPath } from '$lib/server/auth/login';
import { getDatabaseClient } from '$lib/server/db/client';
import { checkRegistrationGuildGate } from '$lib/server/domain/discord';
import { createDiscordGateway } from '$lib/server/gateways/discord/rest';
import {
  buildRegistrationSchema,
  createRegistration,
  getPublicEventBySlug,
  listActiveRegistrationFields,
  registrationAnswersFromData,
  registrationAvailability,
  RegistrationError,
  type RuntimeSchemaMessages
} from '$lib/server/domain/registrations';
import { formatWallClock } from '$lib/server/time';

function schemaMessages(t: App.Locals['t']): RuntimeSchemaMessages {
  return {
    required: t('register.validation_required'),
    tooLong: (maximum) => t('register.validation_too_long', { max: maximum }),
    invalidOption: t('register.validation_option'),
    consentRequired: t('register.validation_consent')
  };
}

async function loadContext(event: RequestEvent) {
  const config = getConfig();
  const organizationSlug = event.params.orgSlug;
  const eventSlug = event.params.eventSlug;
  if (!organizationSlug || !eventSlug) throw error(404);
  const view = await getPublicEventBySlug(getDatabaseClient(config), organizationSlug, eventSlug);
  const availability = registrationAvailability(view.event, view.confirmedCount);
  if (!availability.canRegister) {
    throw new RegistrationError('not_registrable', 'event is not accepting registrations');
  }
  const fields = await listActiveRegistrationFields(getDatabaseClient(config), view.event.id);
  return { view, fields, config };
}

async function guildGate(context: Awaited<ReturnType<typeof loadContext>>, userId: string) {
  return checkRegistrationGuildGate(
    getDatabaseClient(context.config),
    createDiscordGateway(context.config.discord.botToken),
    {
      eventId: context.view.event.id,
      userId,
      policy: context.view.event.discordPolicy
    }
  );
}

function requireRegistrationSession(event: RequestEvent) {
  if (event.locals.session) return event.locals.session;
  throw redirect(303, loginPath(getConfig(), `${event.url.pathname}${event.url.search}`));
}

export const load: PageServerLoad = async (event) => {
  const session = requireRegistrationSession(event);
  try {
    const { view, fields, config } = await loadContext(event);
    const gate = await guildGate({ view, fields, config }, session.userId);
    return {
      title: view.event.title,
      organizationName: view.organizationName,
      description: view.event.description,
      schedule: event.locals.t('event.schedule', {
        start: formatWallClock(view.event.startsAt, event.locals.locale, config.time.zone),
        end: formatWallClock(view.event.endsAt, event.locals.locale, config.time.zone)
      }),
      guildGate: gate,
      fields,
      form: await superValidate(
        zod4(buildRegistrationSchema(fields, schemaMessages(event.locals.t)))
      )
    };
  } catch (cause) {
    if (cause instanceof RegistrationError && cause.code === 'not_found') throw error(404);
    if (cause instanceof RegistrationError && cause.code === 'not_registrable') {
      throw error(409, event.locals.t('register.closed'));
    }
    event.locals.logger.error({ err: cause }, 'load registration form failed');
    throw error(500);
  }
};

export const actions: Actions = {
  register: async (event) => {
    const session = requireRegistrationSession(event);
    let context: Awaited<ReturnType<typeof loadContext>>;
    try {
      context = await loadContext(event);
    } catch (cause) {
      if (cause instanceof RegistrationError && cause.code === 'not_found') throw error(404);
      if (cause instanceof RegistrationError && cause.code === 'not_registrable') {
        throw error(409, event.locals.t('register.closed'));
      }
      throw cause;
    }
    const schema = buildRegistrationSchema(context.fields, schemaMessages(event.locals.t));
    const gate = await guildGate(context, session.userId);
    if (!gate.allowed) {
      return fail(403, { guildGate: gate });
    }
    const form = await superValidate(event, zod4(schema));
    if (!form.valid) return fail(400, { form });

    let registration;
    try {
      registration = await createRegistration(getDatabaseClient(context.config), {
        organizationSlug: event.params.orgSlug!,
        eventSlug: event.params.eventSlug!,
        userId: session.userId,
        displayName: session.displayName,
        answers: registrationAnswersFromData(context.fields, form.data)
      });
    } catch (cause) {
      if (cause instanceof RegistrationError) {
        event.locals.logger.warn({ err: cause, code: cause.code }, 'registration rejected');
        if (cause.code === 'duplicate') {
          return message(form, event.locals.t('register.error_duplicate'), { status: 409 });
        }
        if (cause.code === 'validation') {
          return message(form, event.locals.t('register.error_validation'), { status: 400 });
        }
        if (cause.code === 'not_found') throw error(404);
        if (cause.code === 'forbidden') {
          return message(form, event.locals.t('auth.suspended'), { status: 403 });
        }
        if (cause.code === 'not_registrable') {
          return message(form, event.locals.t('register.closed'), { status: 409 });
        }
      }
      event.locals.logger.error({ err: cause }, 'create registration failed');
      return message(form, event.locals.t('register.error_generic'), { status: 500 });
    }
    throw redirect(303, `/registrations/${registration.id}`);
  }
};
