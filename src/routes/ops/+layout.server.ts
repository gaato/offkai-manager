import type { LayoutServerLoad } from './$types';
import { requirePlatformAdmin } from '$lib/server/auth/guards';

export const load: LayoutServerLoad = (event) => ({
  opsSession: requirePlatformAdmin(event)
});
