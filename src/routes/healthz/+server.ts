import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
  new Response('{"status":"ok"}\n', {
    headers: { 'Content-Type': 'application/json' }
  });
