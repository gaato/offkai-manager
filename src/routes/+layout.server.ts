import type { LayoutServerLoad } from './$types';
import { sourceTreeUrl } from '$lib/shared/source';
import { getConfig } from '$lib/server/config';
import { loginPath } from '$lib/server/auth/login';

export const load: LayoutServerLoad = ({ locals }) => ({
  locale: locals.locale,
  loginPath: loginPath(getConfig(), '/app'),
  session: locals.session,
  sourceUrl: sourceTreeUrl(__SOURCE_REPOSITORY__, __VCS_REF__)
});
