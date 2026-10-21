import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { RateLimitError, type RESTOptions, type ResponseLike } from '@discordjs/rest';
import { commandDefinitions } from '$lib/server/interactions/commands';
import { createInteractionRest } from '$lib/server/interactions/rest';
import { normalizeCommand, registerCommands } from '$lib/server/interactions/registration';
import { applicationId } from '../support/interactions';

function responseLike(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {}
): ResponseLike {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
  return {
    body: null,
    bodyUsed: false,
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
    text: () => response.text(),
    arrayBuffer: () => response.arrayBuffer()
  };
}
function fakeRest(current: unknown[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const makeRequest = vi.fn<RESTOptions['makeRequest']>(async (url, init) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return responseLike(method === 'GET' ? current : {});
  });
  return { rest: createInteractionRest('fake-test-token', { makeRequest }), calls };
}
const foreign = {
  id: '900000000000000009',
  type: 1,
  name: 'other-project',
  description: 'Another project'
};
describe('non-destructive command registration', () => {
  it('runs the Node CLI with source aliases and fails before HTTP without credentials', () => {
    const result = spawnSync(process.execPath, ['scripts/register-commands.ts', '--dry-run'], {
      env: { OFFKAI_AUTH_DEV_BYPASS: 'true' },
      encoding: 'utf8',
      timeout: 10_000
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'OFFKAI_DISCORD_APPLICATION_ID and OFFKAI_DISCORD_BOT_TOKEN are required'
    );
    expect(result.stdout).toBe('');
  });
  it('sorts recursively and drops server fields and implicit defaults', () => {
    expect(
      normalizeCommand({
        version: '2',
        id: '1',
        application_id: applicationId,
        guild_id: '2',
        name: 'name',
        type: 1,
        options: [{ name: 'who', required: false, autocomplete: false }],
        name_localizations: null,
        nsfw: false,
        dm_permission: true
      })
    ).toEqual({ name: 'name', options: [{ name: 'who' }] });
  });
  it('creates ours and leaves unrelated commands intact', async () => {
    const { rest, calls } = fakeRest([foreign]);
    const print = vi.fn();
    await registerCommands(rest, { applicationId, print });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'POST']);
    expect(calls[0].url).toContain('with_localizations=true');
    expect(print).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'create', name: 'offkai' }),
        expect.objectContaining({ operation: 'create', name: 'checkin' })
      ])
    );
  });
  it('PATCHes only changed own commands, without PUT or DELETE', async () => {
    const [offkai, checkin] = commandDefinitions();
    const { rest, calls } = fakeRest([
      {
        ...offkai,
        contexts: undefined,
        integration_types: undefined,
        id: '1',
        description: 'Old description'
      },
      { ...checkin, contexts: undefined, integration_types: undefined, id: '2', version: '9' },
      foreign
    ]);
    await registerCommands(rest, { applicationId, guildId: '400000000000000001', print: vi.fn() });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PATCH']);
    expect(calls[1].url).toContain(`/guilds/400000000000000001/commands/1`);
    const expected = { ...offkai };
    delete expected.contexts;
    delete expected.integration_types;
    expect(calls[1].body).toEqual(JSON.parse(JSON.stringify(expected)));
  });
  it('performs no writes when dry-run includes prune', async () => {
    const { rest, calls } = fakeRest([foreign]);
    const changes = await registerCommands(rest, {
      applicationId,
      dryRun: true,
      prune: true,
      print: vi.fn()
    });
    expect(calls.map((call) => call.method)).toEqual(['GET']);
    expect(changes).toContainEqual(
      expect.objectContaining({ operation: 'delete', name: foreign.name })
    );
  });
  it('deletes foreign commands only with explicit prune', async () => {
    const { rest, calls } = fakeRest([
      ...commandDefinitions().map((command, i) => ({ ...command, id: String(i) })),
      foreign
    ]);
    await registerCommands(rest, { applicationId, prune: true, print: vi.fn() });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE']);
    expect(calls[1].url).toContain(`/commands/${foreign.id}`);
  });
  it('retains same-named commands of other application-command types', async () => {
    const { rest, calls } = fakeRest([{ id: '9', type: 2, name: 'offkai' }]);
    await registerCommands(rest, { applicationId, print: vi.fn() });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'POST']);
  });
  it('prunes the exact foreign command ID even when its name matches ours', async () => {
    const { rest, calls } = fakeRest([
      ...commandDefinitions().map((command, i) => ({ ...command, id: String(i) })),
      { id: 'foreign-user-command', type: 2, name: 'offkai' }
    ]);
    await registerCommands(rest, { applicationId, prune: true, print: vi.fn() });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE']);
    expect(calls[1].url).toContain('/commands/foreign-user-command');
  });
  it('does nothing for commands that normalize equally', async () => {
    const { rest, calls } = fakeRest(
      commandDefinitions().map((command, i) => ({
        ...command,
        id: String(i),
        application_id: applicationId,
        version: '8',
        nsfw: false,
        options: command.options?.map((option) => ({
          ...option,
          required: option.required ?? false
        }))
      }))
    );
    expect(await registerCommands(rest, { applicationId, print: vi.fn() })).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });
  it('rejects 429s with RateLimitError and retryAfter instead of queueing', async () => {
    const rest = createInteractionRest('fake-test-token', {
      makeRequest: async () =>
        responseLike({ message: 'rate limited', retry_after: 1.25, global: false }, 429, {
          'Retry-After': '1.25',
          'X-RateLimit-Limit': '1',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset-After': '1.25'
        })
    });
    try {
      await rest.post(`/applications/${applicationId}/commands`, { body: {} });
      expect.fail('expected rate limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toHaveProperty('retryAfter', 1300);
    }
  });
});
