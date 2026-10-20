import { defineConfig, devices } from '@playwright/test';

const primaryPort = Number(process.env.OFFKAI_E2E_PRIMARY_PORT ?? 18_080);
const productionLikePort = Number(process.env.OFFKAI_E2E_PRODUCTION_PORT ?? 18_081);
const baseURL = `http://127.0.0.1:${primaryPort}`;

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/legacy-reference/**',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      // This wrapper owns a temporary SQLite database, migrates and seeds it,
      // then starts the already-built adapter-node application against that database.
      command: 'node e2e/server.mjs',
      url: `${baseURL}/readyz`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
      env: { OFFKAI_E2E_PORT: String(primaryPort) }
    },
    {
      command: 'node scripts/start.mjs',
      url: `http://127.0.0.1:${productionLikePort}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        HOST: '127.0.0.1',
        PORT: String(productionLikePort),
        OFFKAI_HTTP_ADDR: `127.0.0.1:${productionLikePort}`,
        OFFKAI_PUBLIC_BASE_URL: `http://127.0.0.1:${productionLikePort}`,
        OFFKAI_DATABASE_PATH: ':memory:',
        OFFKAI_SESSION_SECRET: 'e2e-production-session-secret',
        OFFKAI_AUTH_DEV_BYPASS: 'false',
        OFFKAI_DISCORD_CLIENT_ID: 'e2e-production-client',
        OFFKAI_DISCORD_CLIENT_SECRET: 'e2e-production-secret',
        OFFKAI_DISCORD_REDIRECT_URL: `http://127.0.0.1:${productionLikePort}/auth/discord/callback`,
        OFFKAI_DB_MIGRATE: 'false',
        OFFKAI_WORKER_ENABLED: 'false',
        OFFKAI_LOG_LEVEL: 'warn'
      }
    }
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } }
  ]
});
