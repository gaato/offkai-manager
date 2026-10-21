import { z } from 'zod';
import { escapeMarkdown } from '@discordjs/formatters';
import type { APIInteraction, APIInteractionResponse } from 'discord-api-types/v10';
import type { DatabaseClient } from '$lib/server/db/client';
import { ensurePersonalOrganization } from '$lib/server/domain/orgs';
import { interactionContext, resolveInteractionUser } from './context';
import { decodeCustomId, type CustomAction } from './custom-id';
import type { REST } from '@discordjs/rest';
import type { Clock } from '$lib/server/clock';
import type { Tuning } from '$lib/server/config';
import { autocompletePanelEvents } from '$lib/server/domain/discord/panels';
import { postPanel } from './panel-command';
import { participantAction } from './participants';
import { ephemeralReply } from './respond';

type Context = ReturnType<typeof interactionContext>;
export interface RouterDependencies {
  database: () => DatabaseClient;
  publicBaseUrl: string;
  timeZone?: string;
  rest?: REST;
  clock?: Clock;
  tuning?: Tuning;
  defer?: (work: () => Promise<void>) => void;
}
const offkaiOptions = z.tuple([
  z.object({
    type: z.literal(1),
    name: z.enum(['web', 'panel', 'status', 'remind']),
    options: z
      .array(
        z.object({ type: z.literal(3), name: z.enum(['event', 'language']), value: z.string() })
      )
      .max(2)
      .optional()
  })
]);
const checkinOptions = z
  .array(z.object({ type: z.literal(3), name: z.literal('who'), value: z.string().max(100) }))
  .max(1);

export async function dispatchInteraction(
  interaction: APIInteraction,
  dependencies: RouterDependencies
): Promise<APIInteractionResponse> {
  if (interaction.type === 1) return { type: 1 };
  const context = interactionContext(interaction);
  const unknown = () => ephemeralReply(context.t('interaction.unknown'));
  switch (interaction.type) {
    case 2: {
      if (interaction.data.type !== 1) return unknown();
      switch (interaction.data.name) {
        case 'offkai': {
          if (!context.guildId) return unknown();
          const options = offkaiOptions.safeParse(interaction.data.options);
          if (!options.success) return unknown();
          const action = options.data[0].name;
          if (action !== 'panel' && options.data[0].options?.length) return unknown();
          switch (action) {
            case 'web':
              return openWeb(context, dependencies);
            case 'panel': {
              const values = options.data[0].options ?? [];
              const event = z.uuid().safeParse(values.find((o) => o.name === 'event')?.value);
              const language = z
                .enum(['ja', 'en'])
                .safeParse(values.find((o) => o.name === 'language')?.value);
              if (
                !event.success ||
                !language.success ||
                values.length !== 2 ||
                new Set(values.map((o) => o.name)).size !== 2
              )
                return unknown();
              return postPanel(
                context,
                dependencies,
                event.data,
                language.data,
                interaction.application_id,
                interaction.token
              );
            }
            case 'status':
            case 'remind':
              return ephemeralReply(context.t('interaction.soon'));
            default:
              return action satisfies never;
          }
        }
        case 'checkin':
          return checkinOptions.safeParse(interaction.data.options ?? []).success
            ? ephemeralReply(context.t('interaction.soon'))
            : unknown();
        default:
          return unknown();
      }
    }
    case 3:
    case 5: {
      const decoded = decodeCustomId(interaction.data.custom_id);
      if (!decoded.ok) return unknown();
      if (decoded.value.action !== 'web' && decoded.value.action !== 'soon')
        return participantAction(
          decoded.value,
          context,
          dependencies,
          interaction.type === 5 ? interaction : undefined
        );
      return dispatchAction(decoded.value, context, dependencies);
    }
    case 4:
      if (interaction.data.name === 'offkai' && context.actor && context.guildId) {
        const options = interaction.data.options;
        const panel = options?.[0];
        if (panel?.type !== 1 || panel.name !== 'panel') return { type: 8, data: { choices: [] } };
        const focused = panel.options?.find((option) => 'focused' in option && option.focused);
        if (focused?.type !== 3 || focused.name !== 'event')
          return { type: 8, data: { choices: [] } };
        const client = dependencies.database();
        const user = await resolveInteractionUser(client, context.actor);
        return {
          type: 8,
          data: {
            choices: user.suspended
              ? []
              : autocompletePanelEvents(client, user.userId, focused.value, context.guildId)
          }
        };
      }
      switch (interaction.data.name) {
        // Event lookup will be added with check-in; never expose unrelated identities here.
        case 'checkin':
          return { type: 8, data: { choices: [] } };
        default:
          return { type: 8, data: { choices: [] } };
      }
    default: {
      return unknown();
    }
  }
}

function dispatchAction(
  action: Extract<CustomAction, { action: 'web' | 'soon' }>,
  context: Context,
  dependencies: RouterDependencies
): Promise<APIInteractionResponse> | APIInteractionResponse {
  // custom_id only selects behavior. Identity and organization access come from the actor and DB.
  switch (action.action) {
    case 'web':
      return openWeb(context, dependencies);
    case 'soon':
      return ephemeralReply(context.t('interaction.soon'));
    default:
      return action satisfies never;
  }
}

async function openWeb(
  context: Context,
  dependencies: RouterDependencies
): Promise<APIInteractionResponse> {
  if (!context.actor) return ephemeralReply(context.t('interaction.unknown'));
  const client = dependencies.database();
  const user = await resolveInteractionUser(client, context.actor);
  if (user.suspended) return ephemeralReply(context.t('interaction.unavailable'));
  await ensurePersonalOrganization(client, user);
  return ephemeralReply(escapeMarkdown(context.t('interaction.web')), {
    label: context.t('interaction.web_button'),
    url: new URL('/app', dependencies.publicBaseUrl).href
  });
}
