import { getApp } from '$lib/server/app';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { APIInteraction } from 'discord-api-types/v10';
import { getConfig } from '$lib/server/config';
import { getDatabaseClient } from '$lib/server/db/client';
import { verifyInteraction } from '$lib/server/interactions/verify';
import { getLogger } from '$lib/server/logger';
import { getInteractionRest } from '$lib/server/interactions/rest';
import { dispatchInteraction } from '$lib/server/interactions/router';

// Start at most one deferred task per event-loop turn, so a burst of signed
// interactions can be acknowledged while admission work continues between polls.
const deferredWork: (() => Promise<void>)[] = [];
let deferredScheduled = false;
function enqueueDeferred(work: () => Promise<void>) {
  deferredWork.push(work);
  if (deferredScheduled) return;
  deferredScheduled = true;
  const next = () => {
    const task = deferredWork.shift();
    if (!task) {
      deferredScheduled = false;
      return;
    }
    void task();
    setImmediate(next);
  };
  setImmediate(next);
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const config = getConfig();
  if (!config.discord.publicKey) return new Response(null, { status: 503 });
  const rawBody = await request.text();
  if (
    !(await verifyInteraction(
      config.discord.publicKey,
      request.headers.get('X-Signature-Ed25519'),
      request.headers.get('X-Signature-Timestamp'),
      rawBody
    ))
  )
    return new Response(null, { status: 401 });

  let interaction: APIInteraction;
  try {
    // Discord owns the envelope schema. Only our options and custom_id arguments use zod.
    interaction = JSON.parse(rawBody) as APIInteraction;
    if (!interaction || typeof interaction !== 'object') return new Response(null, { status: 400 });
  } catch {
    return new Response(null, { status: 400 });
  }
  if (interaction.application_id !== config.discord.applicationId)
    return new Response(null, { status: 401 });
  return json(
    await dispatchInteraction(interaction, {
      database: () => getDatabaseClient(config),
      publicBaseUrl: config.auth.publicBaseUrl,
      tuning: config.tuning,
      paymentGateway: getApp(config).stripe.payment,
      timeZone: config.time.zone,
      get rest() {
        return config.discord.botToken
          ? getInteractionRest(
              config.discord.botToken,
              config.tuning.OFFKAI_DISCORD_REQUEST_TIMEOUT_MS
            )
          : undefined;
      },
      defer: (work) => {
        enqueueDeferred(async () => {
          await work().catch((err: unknown) =>
            (locals?.logger ?? getLogger(config)).error(
              { error_name: err instanceof Error ? err.name : 'UnknownError' },
              'Deferred Discord interaction failed'
            )
          );
        });
      }
    })
  );
};
