import { discordReturnUrl } from '$lib/server/checkout-return';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ url }) => ({ discordUrl: discordReturnUrl(url) });
