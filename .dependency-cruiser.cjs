/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
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
      to: { circular: true }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: ['node_modules', '\\.svelte-kit'],
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.js', '.ts', '.svelte']
    },
    reporterOptions: {
      text: { highlightFocused: true }
    }
  }
};
