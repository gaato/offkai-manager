import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from 'discord-api-types/v10';
import { translate } from '$lib/i18n';
import { interactionContext } from '$lib/server/interactions/context';
import { dispatchInteraction } from '$lib/server/interactions/router';
import { deferEphemeral, ephemeralReply, updateMessage } from '$lib/server/interactions/respond';
import { commandDefinitions } from '$lib/server/interactions/commands';
import { makeComponent, makeModalSubmit, makeChatInput } from '../support/interactions';

const dependencies = {
  database: vi.fn(() => {
    throw new Error('unexpected database access');
  }),
  publicBaseUrl: 'https://example.test'
};
describe('interaction router and responses', () => {
  beforeEach(() => vi.clearAllMocks());
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
  it.each(['status', 'remind'])('rejects unavailable organizer %s commands', async (subcommand) => {
    expect(await dispatchInteraction(makeChatInput('offkai', subcommand), dependencies)).toEqual(
      ephemeralReply(translate('en', 'door.unavailable'))
    );
  });
  it('routes checkin and known component/modal actions', async () => {
    for (const interaction of [
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
      expect(response.data?.allowed_mentions).toEqual({ parse: [] });
    expect(deferEphemeral().data.flags).toBe(64);
  });
  it('edits a source message with V2 flags and cleared controls, preserving mention suppression', () => {
    const response = updateMessage(ephemeralReply('Queued 1 reminders.'));
    expect(response.type).toBe(7);
    expect(response.data?.flags).toBe(32768);
    expect(response.data?.allowed_mentions).toEqual({ parse: [] });
    expect(response.data?.components).toEqual([{ type: 10, content: 'Queued 1 reminders.' }]);
  });
  it.each([
    { values: [] },
    { values: ['invalid'] },
    { values: ['12345678-1234-4234-8234-123456789012', '12345678-1234-4234-8234-123456789013'] }
  ])('rejects malformed event select values $values before database access', async ({ values }) => {
    const interaction = makeComponent();
    interaction.data = { component_type: 3, custom_id: 'om1:reception_pick:remind', values };
    expect(await dispatchInteraction(interaction, dependencies)).toEqual(
      updateMessage(ephemeralReply(translate('en', 'interaction.unknown')))
    );
    expect(dependencies.database).not.toHaveBeenCalled();
  });
  it('rejects a select disguised as a receipt button and a button disguised as an event select', async () => {
    const receipt = makeComponent();
    receipt.data = {
      component_type: 3,
      custom_id: 'om1:door_cash:12345678-1234-4234-8234-123456789012',
      values: []
    };
    const picker = makeComponent('om1:reception_pick:status');
    for (const interaction of [receipt, picker, makeModalSubmit('om1:reception_pick:status')])
      expect(await dispatchInteraction(interaction, dependencies)).toEqual(
        ephemeralReply(translate('en', 'interaction.unknown'))
      );
    expect(dependencies.database).not.toHaveBeenCalled();
  });
  it('validates the localized command JSON and permission/contexts', () => {
    const [offkai, checkin] = commandDefinitions();
    expect(offkai).toMatchObject({
      name: 'offkai',
      type: 1,
      contexts: [0],
      integration_types: [0],
      name_localizations: { ja: 'オフ会' }
    });
    expect(offkai.options?.map((option) => option.name)).toEqual([
      'web',
      'panel',
      'status',
      'remind'
    ]);
    expect(checkin.default_member_permissions).toBeUndefined();
    expect(offkai.default_member_permissions).toBeNull();
    expect(checkin).toMatchObject({
      name: 'checkin',
      contexts: [0],
      integration_types: [0],
      options: [
        { type: 3, name: 'who', autocomplete: true, required: true },
        { type: 3, name: 'event', autocomplete: true }
      ]
    });
  });
});
