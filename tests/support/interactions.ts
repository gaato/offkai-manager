import type {
  APIApplicationCommandAutocompleteInteraction,
  APIChatInputApplicationCommandInteraction,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
  APIInteraction,
  APIMessage,
  APIUser,
  Locale
} from 'discord-api-types/v10';

export const applicationId = '100000000000000001';
export const actor: APIUser = {
  id: '200000000000000001',
  username: 'organizer',
  global_name: 'Organizer',
  discriminator: '0',
  avatar: null
};
const base = () => ({
  id: '300000000000000001',
  application_id: applicationId,
  token: 'test-interaction-token',
  version: 1 as const,
  locale: 'en-US' as Locale,
  app_permissions: '0',
  entitlements: [],
  authorizing_integration_owners: {},
  attachment_size_limit: 10485760,
  guild_id: '400000000000000001',
  channel_id: '500000000000000001',
  channel: { id: '500000000000000001', type: 0 as const },
  member: {
    user: actor,
    roles: ['600000000000000001'],
    permissions: '32',
    joined_at: '2026-01-01T00:00:00Z',
    deaf: false,
    mute: false,
    flags: 0
  }
});
export function makeChatInput(
  name = 'offkai',
  subcommand = 'web'
): APIChatInputApplicationCommandInteraction {
  return {
    ...base(),
    type: 2,
    data: {
      id: '700000000000000001',
      type: 1,
      name,
      options: name === 'offkai' ? [{ type: 1, name: subcommand }] : []
    }
  };
}
const message = (): APIMessage => ({
  id: '800000000000000001',
  channel_id: '500000000000000001',
  author: actor,
  content: '',
  timestamp: '2026-01-01T00:00:00Z',
  edited_timestamp: null,
  tts: false,
  mention_everyone: false,
  mentions: [],
  mention_roles: [],
  attachments: [],
  embeds: [],
  pinned: false,
  type: 0,
  components: []
});
export function makeComponent(customId = 'om1:web'): APIMessageComponentInteraction {
  return {
    ...base(),
    type: 3,
    message: message(),
    data: { component_type: 2, custom_id: customId }
  };
}
export function makeModalSubmit(customId = 'om1:soon:panel'): APIModalSubmitInteraction {
  return { ...base(), type: 5, data: { custom_id: customId, components: [] } };
}
export function makeAutocomplete(value = ''): APIApplicationCommandAutocompleteInteraction {
  return {
    ...base(),
    type: 4,
    data: {
      id: '700000000000000002',
      type: 1,
      name: 'checkin',
      options: [{ type: 3, name: 'who', value, focused: true }]
    }
  };
}

export async function generateSigningKey() {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString(
    'hex'
  );
  return { ...keys, publicKeyHex: publicKey };
}
export async function signedRequest(
  payload: APIInteraction | string,
  privateKey: CryptoKey,
  timestamp = String(Math.floor(Date.now() / 1000))
) {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    new TextEncoder().encode(timestamp + rawBody)
  );
  return new Request('https://example.test/interactions', {
    method: 'POST',
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Timestamp': timestamp,
      'X-Signature-Ed25519': Buffer.from(signature).toString('hex')
    }
  });
}

export async function callInteraction(payload: APIInteraction | string, privateKey: CryptoKey) {
  const { POST } = await import('../../src/routes/interactions/+server');
  return POST({ request: await signedRequest(payload, privateKey) } as Parameters<typeof POST>[0]);
}
