import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { getAdminRegistrationDetail, RegistrationError } from '$lib/server/domain/registrations';
import { OrganizationError } from '$lib/server/domain/orgs';

export const load: PageServerLoad = async (event) => {
  const session = requireSession(event);
  const registrationId = z.uuid().safeParse(event.params.registrationId);
  if (!registrationId.success) throw error(404);
  try {
    const detail = await getAdminRegistrationDetail(
      getDatabaseClient(getConfig()),
      session.userId,
      registrationId.data
    );
    if (!detail.canMutate || detail.registration.status === 'cancelled') throw error(404);
    return {
      event: detail.event,
      registration: detail.registration
    };
  } catch (cause) {
    if (
      (cause instanceof RegistrationError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    throw cause;
  }
};
