import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie, isSecureRequest } from '$lib/server/auth/session';

export const POST: RequestHandler = (event) => {
  clearSessionCookie(event.cookies, isSecureRequest(event));
  throw redirect(303, '/');
};
