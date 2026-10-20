import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginPath } from '$lib/server/auth/login';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getGuildJoinGuidance } from '$lib/server/domain/discord';
import { getPublicEventBySlug, RegistrationError } from '$lib/server/domain/registrations';

export const load: PageServerLoad = async (event) => {
  if (!event.locals.session) {
    throw redirect(303, loginPath(getConfig(), `${event.url.pathname}${event.url.search}`));
  }
  const organizationSlug = event.params.orgSlug;
  const eventSlug = event.params.eventSlug;
  if (!organizationSlug || !eventSlug) throw error(404);
  try {
    const view = await getPublicEventBySlug(
      getDatabaseClient(getConfig()),
      organizationSlug,
      eventSlug
    );
    if (view.event.discordPolicy !== 'guild_join_required') throw error(404);
    return {
      title: view.event.title,
      organizationName: view.organizationName,
      ...(await getGuildJoinGuidance(getDatabaseClient(getConfig()), view.event.id))
    };
  } catch (cause) {
    if (cause instanceof RegistrationError && cause.code === 'not_found') throw error(404);
    throw cause;
  }
};
