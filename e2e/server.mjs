import { spawn } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createServer } from 'vite';

const port = process.env.OFFKAI_E2E_PORT ?? '18080';
const noAbusePort = process.env.OFFKAI_E2E_NO_ABUSE_PORT ?? '18082';
const container = await new PostgreSqlContainer('postgres:17-alpine').start();
const databaseUrl = container.getConnectionUri();

const apps = [];
try {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false }
  });
  try {
    const { seedE2E } = await vite.ssrLoadModule('/e2e/seed.ts');
    await seedE2E(databaseUrl);
  } finally {
    await vite.close();
  }

  const noAbuseApp = spawnApp(noAbusePort, '');
  apps.push(noAbuseApp);
  await waitForReady(`http://127.0.0.1:${noAbusePort}/readyz`, noAbuseApp);
  apps.push(spawnApp(port, 'abuse@example.test'));
} catch (cause) {
  for (const app of apps) {
    if (app.exitCode === null) app.kill('SIGTERM');
  }
  await container.stop();
  throw cause;
}

function spawnApp(appPort, abuseReportEmail) {
  return spawn(process.execPath, ['scripts/start.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: appPort,
      OFFKAI_HTTP_ADDR: `127.0.0.1:${appPort}`,
      OFFKAI_PUBLIC_BASE_URL: `http://127.0.0.1:${appPort}`,
      OFFKAI_DATABASE_URL: databaseUrl,
      OFFKAI_AUTH_DEV_BYPASS: 'true',
      OFFKAI_CAMPAIGNS_ENABLED: 'true',
      OFFKAI_ABUSE_REPORT_EMAIL: abuseReportEmail,
      OFFKAI_SESSION_SECRET: 'e2e-development-session-secret',
      OFFKAI_DB_MIGRATE: 'false',
      OFFKAI_CLIENT_IP_HEADER: 'X-Test-Client-IP',
      OFFKAI_WORKER_ENABLED: 'false',
      OFFKAI_LOG_LEVEL: 'warn'
    }
  });
}

async function waitForReady(url, app) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null)
      throw new Error(`E2E app exited before becoming ready (${app.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The adapter has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E app did not become ready: ${url}`);
}

let shutdownPromise;
function stop(signal) {
  shutdownPromise ??= (async () => {
    for (const app of apps) {
      if (app.exitCode === null) app.kill(signal);
    }
    await container.stop();
  })();
  return shutdownPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void stop(signal).then(
      () => process.exit(0),
      (cause) => {
        process.stderr.write(`E2E shutdown failed: ${String(cause)}\n`);
        process.exit(1);
      }
    );
  });
}

for (const app of apps) {
  app.on('exit', (code, signal) => {
    if (shutdownPromise) return;
    if (code && code !== 0) process.stderr.write(`E2E app exited (${signal ?? code})\n`);
    void stop('SIGTERM').then(
      () => process.exit(code ?? 0),
      (cause) => {
        process.stderr.write(`E2E shutdown failed: ${String(cause)}\n`);
        process.exit(1);
      }
    );
  });
}
