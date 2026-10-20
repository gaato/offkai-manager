import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireSession } from '$lib/server/auth/guards';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { CampaignError, getCampaignForOrganization } from '$lib/server/domain/campaigns';
import { OrganizationError } from '$lib/server/domain/orgs';
import { buildCampaignPledgesCSV } from '$lib/server/exports/campaign-pledges';

export const GET: RequestHandler = async (event) => {
  const session = requireSession(event);
  const campaignId = z.uuid().safeParse(event.params.campaignId);
  if (!campaignId.success) throw error(404);
  try {
    const config = getConfig();
    const data = await getCampaignForOrganization(
      getDatabaseClient(config),
      session.userId,
      campaignId.data
    );
    return new Response(buildCampaignPledgesCSV(data, event.locals.locale, config.time.zone), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="campaign-${campaignId.data}-pledges.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (cause) {
    if (
      (cause instanceof CampaignError && cause.code === 'not_found') ||
      (cause instanceof OrganizationError && ['not_found', 'forbidden'].includes(cause.code))
    ) {
      throw error(404);
    }
    event.locals.logger.error({ err: cause }, 'export campaign pledges failed');
    throw error(500);
  }
};
