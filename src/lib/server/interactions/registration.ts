import type { REST } from '@discordjs/rest';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord-api-types/v10';
import { commandDefinitions } from './commands';

type Command = RESTPostAPIChatInputApplicationCommandsJSONBody;
type RegisteredCommand = Command & { id: string };
const assigned = new Set([
  'id',
  'application_id',
  'guild_id',
  'version',
  'name_localized',
  'description_localized',
  'default_permission'
]);

export function normalizeCommand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCommand);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value).filter(
    ([key, val]) =>
      !assigned.has(key) &&
      val !== undefined &&
      val !== null &&
      // Discord supplies defaults omitted by builders; omit them on both sides.
      !(key === 'type' && val === 1) &&
      !(['required', 'autocomplete', 'nsfw'].includes(key) && val === false) &&
      !(key === 'dm_permission' && (val === true || 'contexts' in value)) &&
      !(Array.isArray(val) && val.length === 0)
  );
  return Object.fromEntries(
    entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalizeCommand(val)])
  );
}

export interface CommandChange {
  operation: 'create' | 'edit' | 'delete';
  name: string;
  commandId?: string;
  before?: unknown;
  after?: unknown;
}

export async function registerCommands(
  rest: REST,
  options: {
    applicationId: string;
    guildId?: string;
    dryRun?: boolean;
    prune?: boolean;
    print: (diff: readonly CommandChange[]) => void;
  }
) {
  const route =
    `/applications/${options.applicationId}${options.guildId ? `/guilds/${options.guildId}` : ''}/commands` as const;
  // with_localizations is necessary to compare localization maps, not just localized display fields.
  const current = (await rest.get(route, {
    query: new URLSearchParams({ with_localizations: 'true' })
  })) as RegisteredCommand[];
  const desired = commandDefinitions().map((command) => {
    if (!options.guildId) return command;
    // Guild commands are inherently guild-only; these fields apply only to global commands.
    const guildCommand = { ...command };
    delete guildCommand.contexts;
    delete guildCommand.integration_types;
    return guildCommand;
  });
  const changes: CommandChange[] = [];
  for (const command of desired) {
    const existing = current.find((entry) => entry.name === command.name && entry.type === 1);
    const before = existing ? normalizeCommand(existing) : undefined;
    const after = normalizeCommand(command);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({
        operation: existing ? 'edit' : 'create',
        name: command.name,
        ...(existing ? { commandId: existing.id } : {}),
        before,
        after
      });
    }
  }
  if (options.prune) {
    for (const command of current) {
      if (!desired.some((entry) => entry.name === command.name && command.type === 1))
        changes.push({
          operation: 'delete',
          name: command.name,
          commandId: command.id,
          before: normalizeCommand(command)
        });
    }
  }
  options.print(changes);
  if (options.dryRun) return changes;
  for (const change of changes) {
    if (change.operation === 'delete') {
      await rest.delete(`${route}/${change.commandId}`);
    } else {
      const body = desired.find((entry) => entry.name === change.name)!;
      if (change.commandId) await rest.patch(`${route}/${change.commandId}`, { body });
      else await rest.post(route, { body });
    }
  }
  return changes;
}
