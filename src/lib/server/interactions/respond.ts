import { ActionRowBuilder, ButtonBuilder, TextDisplayBuilder } from '@discordjs/builders';
import type {
  APIInteractionResponseChannelMessageWithSource,
  APIInteractionResponseDeferredChannelMessageWithSource
} from 'discord-api-types/v10';

export function ephemeralReply(
  text: string,
  link?: { label: string; url: string }
): APIInteractionResponseChannelMessageWithSource {
  return {
    type: 4,
    data: {
      flags: 64 | 32768, // EPHEMERAL | IS_COMPONENTS_V2
      allowed_mentions: { parse: [] },
      components: [
        new TextDisplayBuilder().setContent(text).toJSON(),
        ...(link
          ? [
              new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                  new ButtonBuilder().setStyle(5).setLabel(link.label).setURL(link.url)
                )
                .toJSON()
            ]
          : [])
      ]
    }
  };
}

export function deferEphemeral(): APIInteractionResponseDeferredChannelMessageWithSource & {
  data: { allowed_mentions: { parse: never[] } };
} {
  // V2 is applied when editing the deferred response; Discord only permits EPHEMERAL here.
  return { type: 5, data: { flags: 64, allowed_mentions: { parse: [] } } };
}
