/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-has-no-discord-transport',
      severity: 'error',
      from: { path: '^src/lib/server/domain/' },
      to: {
        path: '(^src/lib/server/interactions/|^\\$lib/server/interactions/|(^|node_modules/)@discordjs/|(^|node_modules/)discord-api-types(/|$))'
      }
    },
    {
      name: 'domain-is-framework-free',
      from: { path: '^src/lib/server/domain/' },
      to: {
        path: '(^src/routes/|^src/lib/components/|^src/lib/server/gateways/(?!interfaces/)|^\\$app/|^@sveltejs/kit)'
      }
    },
    {
      name: 'shared-and-i18n-are-client-safe',
      from: { path: '^src/lib/(shared|i18n)/' },
      to: { path: '^src/lib/server/' }
    },
    {
      name: 'routes-use-database-and-stripe-adapters',
      from: { path: '^src/routes/' },
      to: { path: '^(better-sqlite3|stripe)$' }
    },
    {
      name: 'timezone-library-is-centralized',
      from: { path: '^src/(?!lib/server/time/|lib/shared/money/)' },
      to: { path: '^@date-fns/tz$' }
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      // Preserve the existing runtime-cycle policy while inspecting type imports for boundaries.
      to: { circular: true, viaOnly: { dependencyTypesNot: ['pre-compilation-only'] } }
    }
  ],
  options: {
    // Type-only imports must obey the domain transport boundary too.
    tsPreCompilationDeps: 'specify',
    doNotFollow: { path: 'node_modules' },
    // Keep external dependency edges visible to boundary rules; doNotFollow stops traversal.
    exclude: ['\\.svelte-kit'],
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.js', '.ts', '.svelte']
    },
    reporterOptions: {
      text: { highlightFocused: true }
    }
  }
};
