import { describe, expect, it, vi } from 'vitest';
import { loginPath } from '$lib/server/auth/login';
import { safeReturnTo } from '$lib/server/auth/return-to';
import { loadConfig } from '$lib/server/config';
import { discordAuthorizationUrl, exchangeDiscordCode } from '$lib/server/gateways/discord/oauth';

const oauthConfig = {
  clientId: 'discord-client-id',
  clientSecret: 'discord-client-secret',
  redirectUrl: 'https://example.test/auth/discord/callback'
};

describe('Discord OAuth', () => {
  it('requests only the identify scope and carries the state', () => {
    const url = new URL(discordAuthorizationUrl(oauthConfig, 'signed-state'));
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('identify');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });
  it('narrows token and user payloads before returning snapshots', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'access-token', token_type: 'Bearer', extra: true })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: '123456789012345678',
          username: 'discord-user',
          global_name: 'Display Name',
          avatar: 'avatar-hash',
          ignored: true
        })
      );
    await expect(exchangeDiscordCode(oauthConfig, 'code', fetchMock)).resolves.toEqual({
      providerUserId: '123456789012345678',
      username: 'discord-user',
      displayName: 'Display Name',
      avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/avatar-hash.png'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects unsafe return paths and uses the dev login fallback', () => {
    expect(safeReturnTo('https://attacker.example')).toBe('/app');
    expect(safeReturnTo('//attacker.example/path')).toBe('/app');
    expect(safeReturnTo('/\\attacker.example')).toBe('/app');
    expect(safeReturnTo('/app/organizations?tab=team')).toBe('/app/organizations?tab=team');
    const config = loadConfig({ OFFKAI_AUTH_DEV_BYPASS: 'true' });
    expect(loginPath(config, '/app')).toBe('/auth/dev?return_to=%2Fapp');
  });
});
