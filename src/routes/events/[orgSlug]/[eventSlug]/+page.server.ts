import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import {
  getPublicEventBySlug,
  publicVenue,
  registrationAvailability,
  RegistrationError
} from '$lib/server/domain/registrations';
import { formatWallClock } from '$lib/server/time';

export const load: PageServerLoad = async ({ locals, params }) => {
  const config = getConfig();
  let view;
  try {
    view = await getPublicEventBySlug(getDatabaseClient(config), params.orgSlug, params.eventSlug);
  } catch (cause) {
    if (cause instanceof RegistrationError && cause.code === 'not_found') throw error(404);
    locals.logger.error({ err: cause }, 'load public event failed');
    throw error(500);
  }

  const { event } = view;
  const schedule = locals.t('event.schedule', {
    start: formatWallClock(event.startsAt, locals.locale, config.time.zone),
    end: formatWallClock(event.endsAt, locals.locale, config.time.zone)
  });
  const venue = publicVenue(event, false);
  const availability = registrationAvailability(event, view.confirmedCount);
  const capacityRemaining =
    event.capacity === null ? null : Math.max(0, event.capacity - view.confirmedCount);
  const registrationState =
    availability.state === 'before_open'
      ? locals.t('public_event.registration_opens_at', {
          time: formatWallClock(availability.opensAt, locals.locale, config.time.zone)
        })
      : locals.t(`public_event.registration_${availability.state}`);
  const description = locals.t('public_event.meta_description', {
    schedule,
    organizer: view.organizationName
  });

  return {
    title: event.title,
    organizationName: view.organizationName,
    description: event.description,
    schedule,
    venue,
    capacityRemaining,
    contact: event.contact,
    cancellationPolicy: event.cancellationPolicy,
    cancelled: event.cancelledAt !== null,
    registrationState,
    canRegister: availability.canRegister,
    registerHref: `/events/${encodeURIComponent(view.organizationSlug)}/${encodeURIComponent(event.slug)}/register`,
    meta: {
      description,
      noindex: event.visibility === 'unlisted'
    }
  };
};
