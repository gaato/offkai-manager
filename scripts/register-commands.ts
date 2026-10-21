import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node strips TypeScript, but does not resolve SvelteKit aliases or extensionless imports.
// Resolve only local source modules so this CLI can share the validated builders and config.
const source = new URL('../src/lib/', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidate = specifier.startsWith('$lib/')
      ? new URL(specifier.slice(5), source)
      : specifier.startsWith('.') && context.parentURL?.startsWith(source.href)
        ? new URL(specifier, context.parentURL)
        : undefined;
    if (candidate) {
      for (const suffix of ['', '.ts', '/index.ts']) {
        const path = fileURLToPath(candidate) + suffix;
        if (existsSync(path) && (path.endsWith('.ts') || path.endsWith('.js')))
          return nextResolve(pathToFileURL(path).href, context);
      }
    }
    return nextResolve(specifier, context);
  }
});

const args = process.argv.slice(2);
if (args.some((arg) => !['--prune', '--dry-run'].includes(arg))) {
  throw new Error('Usage: pnpm commands:register [--dry-run] [--prune]');
}
const { getConfig } = await import('../src/lib/server/config.ts');
const { createInteractionRest } = await import('../src/lib/server/interactions/rest.ts');
const { registerCommands } = await import('../src/lib/server/interactions/registration.ts');
const config = getConfig();
if (!config.discord.applicationId || !config.discord.botToken)
  throw new Error('OFFKAI_DISCORD_APPLICATION_ID and OFFKAI_DISCORD_BOT_TOKEN are required');
await registerCommands(createInteractionRest(config.discord.botToken), {
  applicationId: config.discord.applicationId,
  guildId: config.discord.commandGuildId || undefined,
  dryRun: args.includes('--dry-run'),
  prune: args.includes('--prune'),
  print: (changes) => process.stdout.write(JSON.stringify(changes, null, 2) + '\n')
});
