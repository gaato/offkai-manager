import { SlashCommandBuilder } from '@discordjs/builders';
import { translate, type MessageKey } from '$lib/i18n';

type CommandPart = 'offkai' | 'web' | 'panel' | 'status' | 'remind' | 'checkin' | 'who';
function labels(part: CommandPart) {
  const name: MessageKey = `command.${part}.name`;
  const description: MessageKey = `command.${part}.description`;
  return {
    name: translate('en', name),
    description: translate('en', description),
    names: {
      'en-US': translate('en', name),
      'en-GB': translate('en', name),
      ja: translate('ja', name)
    },
    descriptions: {
      'en-US': translate('en', description),
      'en-GB': translate('en', description),
      ja: translate('ja', description)
    }
  };
}

export function commandDefinitions() {
  const offkaiLabels = labels('offkai');
  const offkai = new SlashCommandBuilder()
    .setName(offkaiLabels.name)
    .setNameLocalizations(offkaiLabels.names)
    .setDescription(offkaiLabels.description)
    .setDescriptionLocalizations(offkaiLabels.descriptions)
    .setContexts(0)
    .setIntegrationTypes(0)
    .setDefaultMemberPermissions(null);
  for (const part of ['web', 'panel', 'status', 'remind'] as const) {
    const l = labels(part);
    offkai.addSubcommand((sub) => {
      sub
        .setName(l.name)
        .setNameLocalizations(l.names)
        .setDescription(l.description)
        .setDescriptionLocalizations(l.descriptions);
      if (part !== 'web') {
        sub.addStringOption((option) =>
          option
            .setName(translate('en', 'command.event.name'))
            .setNameLocalizations({ ja: translate('ja', 'command.event.name') })
            .setDescription(translate('en', 'panel.event_option'))
            .setDescriptionLocalizations({ ja: translate('ja', 'panel.event_option') })
            .setRequired(part === 'panel')
            .setAutocomplete(true)
        );
        if (part === 'panel')
          sub.addStringOption((option) =>
            option
              .setName(translate('en', 'command.language.name'))
              .setNameLocalizations({ ja: translate('ja', 'command.language.name') })
              .setDescription(translate('en', 'panel.language_option'))
              .setDescriptionLocalizations({ ja: translate('ja', 'panel.language_option') })
              .setRequired(true)
              .addChoices(
                {
                  name: translate('en', 'panel.language_ja'),
                  name_localizations: { ja: translate('ja', 'panel.language_ja') },
                  value: 'ja'
                },
                {
                  name: translate('en', 'panel.language_en'),
                  name_localizations: { ja: translate('ja', 'panel.language_en') },
                  value: 'en'
                }
              )
          );
      }
      return sub;
    });
  }
  const checkinLabels = labels('checkin');
  const who = labels('who');
  const checkin = new SlashCommandBuilder()
    .setName(checkinLabels.name)
    .setNameLocalizations(checkinLabels.names)
    .setDescription(checkinLabels.description)
    .setDescriptionLocalizations(checkinLabels.descriptions)
    .setContexts(0)
    .setIntegrationTypes(0)
    .addStringOption((option) =>
      option
        .setName(who.name)
        .setNameLocalizations(who.names)
        .setDescription(who.description)
        .setDescriptionLocalizations(who.descriptions)
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName(translate('en', 'command.event.name'))
        .setNameLocalizations({ ja: translate('ja', 'command.event.name') })
        .setDescription(translate('en', 'panel.event_option'))
        .setDescriptionLocalizations({ ja: translate('ja', 'panel.event_option') })
        .setAutocomplete(true)
    );
  return [offkai.toJSON(), checkin.toJSON()];
}
