import { describe, expect, it, vi } from 'vitest';
import type { Locale } from 'discord-api-types/v10';
import { translate } from '$lib/i18n';
import { interactionContext } from '$lib/server/interactions/context';
import { dispatchInteraction } from '$lib/server/interactions/router';
import { deferEphemeral, ephemeralReply } from '$lib/server/interactions/respond';
import { commandDefinitions } from '$lib/server/interactions/commands';
import { makeComponent, makeModalSubmit, makeChatInput } from '../support/interactions';

const dependencies = {
  database: vi.fn(() => {
    throw new Error('unexpected database access');
  }),
  publicBaseUrl: 'https://example.test'
};
describe('interaction router and responses', () => {
  it.each(['en', 'ja'] as const)(
    'unknown component and modal actions are ephemeral in %s',
    async (locale) => {
      for (const interaction of [makeComponent('om1:gone'), makeModalSubmit('om0:expired')]) {
        interaction.locale = (locale === 'ja' ? 'ja' : 'en-US') as Locale;
        expect(await dispatchInteraction(interaction, dependencies)).toEqual(
          ephemeralReply(translate(locale, 'interaction.unknown'))
        );
      }
    }
  );
  it.each(['status', 'remind'])('routes offkai %s to coming soon', async (subcommand) => {
    expect(await dispatchInteraction(makeChatInput('offkai', subcommand), dependencies)).toEqual(
      ephemeralReply(translate('en', 'interaction.soon'))
    );
  });
  it('routes checkin and known component/modal actions', async () => {
    for (const interaction of [
      makeChatInput('checkin'),
      makeComponent('om1:soon:checkin'),
      makeModalSubmit('om1:soon:panel')
    ])
      expect(await dispatchInteraction(interaction, dependencies)).toEqual(
        ephemeralReply(translate('en', 'interaction.soon'))
      );
  });
  it('rejects unknown commands and invalid own options without effects', async () => {
    for (const interaction of [makeChatInput('foreign'), makeChatInput('offkai', 'foreign')])
      expect(await dispatchInteraction(interaction, dependencies)).toEqual(
        ephemeralReply(translate('en', 'interaction.unknown'))
      );
    expect(dependencies.database).not.toHaveBeenCalled();
  });
  it('prefers member.user and exposes locale, roles and context', () => {
    const interaction = makeChatInput();
    interaction.user = { ...interaction.member!.user, id: '999999999999999999' };
    interaction.locale = 'ja' as Locale;
    expect(interactionContext(interaction)).toMatchObject({
      actor: interaction.member!.user,
      locale: 'ja',
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      appPermissions: interaction.app_permissions,
      roles: interaction.member!.roles
    });
  });
  it('uses user for DMs and defaults unsupported locales to English', () => {
    const interaction = makeChatInput();
    interaction.user = interaction.member!.user;
    delete interaction.member;
    interaction.locale = 'fr' as Locale;
    expect(interactionContext(interaction)).toMatchObject({
      actor: interaction.user,
      locale: 'en',
      roles: []
    });
  });
  it('always suppresses mentions, including deferred replies', () => {
    for (const response of [
      ephemeralReply('@everyone'),
      ephemeralReply('link', { label: 'Open', url: 'https://example.test' }),
      deferEphemeral()
    ])
      expect(response.data.allowed_mentions).toEqual({ parse: [] });
    expect(deferEphemeral().data.flags).toBe(64);
  });
  it('validates the localized command JSON and permission/contexts', () => {
    const [offkai, checkin] = commandDefinitions();
    expect(offkai).toMatchObject({
      name: 'offkai',
      type: 1,
      contexts: [0],
      integration_types: [0],
      default_member_permissions: '32',
      name_localizations: { ja: 'オフ会' }
    });
    expect(offkai.options?.map((option) => option.name)).toEqual([
      'web',
      'panel',
      'status',
      'remind'
    ]);
    expect(checkin).toMatchObject({
      name: 'checkin',
      contexts: [0],
      integration_types: [0],
      options: [{ type: 3, name: 'who', autocomplete: true }]
    });
  });
});
