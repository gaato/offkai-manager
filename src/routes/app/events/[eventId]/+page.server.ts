import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getEventDiscordSettings } from '$lib/server/domain/discord';
import {
  EventError,
  publishEvent,
  toggleEventUnlisted,
  type EventMutationInput
} from '$lib/server/domain/events';
import { getEventDashboard } from '$lib/server/domain/events/dashboard';
import { OrganizationError } from '$lib/server/domain/orgs';

export const load: PageServerLoad = async (event) => {
  const session = requireSession(event);
  const eventId = z.uuid().safeParse(event.params.eventId);
  if (!eventId.success) throw error(404);
  const config = getConfig();
  return {
    dashboard: getEventDashboard(getDatabaseClient(config), session.userId, eventId.data),
    discordSettings: await getEventDiscordSettings(
      getDatabaseClient(config),
      session.userId,
      eventId.data
    )
  };
};

export const actions: Actions = {
  publish: (event) => lifecycleAction(event, publishEvent),
  toggleUnlisted: (event) => lifecycleAction(event, toggleEventUnlisted)
};

async function lifecycleAction(
  event: RequestEvent,
  mutation: (
    client: ReturnType<typeof getDatabaseClient>,
    input: EventMutationInput
  ) => Promise<unknown>
) {
  const session = requireSession(event);
  const eventId = z.uuid().safeParse(event.params.eventId);
  if (!eventId.success) throw error(404);
  try {
    await mutation(getDatabaseClient(getConfig()), {
      actorUserId: session.userId,
      eventId: eventId.data
    });
    return { actionMessage: event.locals.t('event.action_success') };
  } catch (cause) {
    event.locals.logger[
      cause instanceof EventError || cause instanceof OrganizationError ? 'warn' : 'error'
    ]({ err: cause }, 'change event lifecycle failed');
    return fail(eventStatus(cause), { actionError: eventMessage(event, cause) });
  }
}

function eventStatus(cause: unknown): 400 | 403 | 404 | 409 | 500 {
  if (cause instanceof EventError) {
    if (cause.code === 'not_found') return 404;
    if (cause.code === 'forbidden') return 403;
    if (cause.code === 'illegal_transition') return 409;
    if (cause.code === 'validation') return 400;
  }
  if (cause instanceof OrganizationError) {
    if (cause.code === 'not_found') return 404;
    if (cause.code === 'forbidden') return 403;
    return 409;
  }
  return 500;
}

function eventMessage(event: RequestEvent, cause: unknown) {
  if (cause instanceof EventError && cause.code === 'illegal_transition') {
    return event.locals.t('event.error_illegal_transition');
  }
  if (
    (cause instanceof EventError && cause.code === 'forbidden') ||
    (cause instanceof OrganizationError && cause.code === 'forbidden')
  ) {
    return event.locals.t('event.error_forbidden');
  }
  if (cause instanceof EventError && cause.code === 'validation') {
    return event.locals.t('event.error_validation');
  }
  return event.locals.t('event.error_generic');
}
