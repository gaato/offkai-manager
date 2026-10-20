import type { RequestHandler } from './$types';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient, pingDatabase } from '$lib/server/db/client';

export const GET: RequestHandler = async () => {
  const config = getConfig();
  if (!config.database.path && config.auth.devBypass) {
    return Response.json({ status: 'ok', db: 'skipped' });
  }
  try {
    await Promise.race([
      pingDatabase(getDatabaseClient(config)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('database readiness timeout')), 2_000)
      )
    ]);
    return Response.json({ status: 'ok', db: 'ok' });
  } catch {
    return Response.json({ status: 'unavailable', db: 'unavailable' }, { status: 503 });
  }
};
