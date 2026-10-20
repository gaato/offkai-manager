import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const port = process.env.OFFKAI_E2E_PORT ?? '18080';
const directory = await mkdtemp(join(tmpdir(), 'offkai-e2e-'));
const databasePath = join(directory, 'offkai.sqlite');

const apps = [];
try {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false }
  });
  try {
    const { seedE2E } = await vite.ssrLoadModule('/e2e/seed.ts');
    await seedE2E(databasePath);
  } finally {
    await vite.close();
  }

  apps.push(spawnApp(port));
} catch (cause) {
  for (const app of apps) {
    if (app.exitCode === null) app.kill('SIGTERM');
  }
  await rm(directory, { recursive: true, force: true });
  throw cause;
}

function spawnApp(appPort) {
  return spawn(process.execPath, ['scripts/start.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: appPort,
      OFFKAI_HTTP_ADDR: `127.0.0.1:${appPort}`,
      OFFKAI_PUBLIC_BASE_URL: `http://127.0.0.1:${appPort}`,
      OFFKAI_DATABASE_PATH: databasePath,
      OFFKAI_AUTH_DEV_BYPASS: 'true',
      OFFKAI_SESSION_SECRET: 'e2e-development-session-secret',
      OFFKAI_DB_MIGRATE: 'false',
      OFFKAI_CLIENT_IP_HEADER: 'X-Test-Client-IP',
      OFFKAI_WORKER_ENABLED: 'false',
      OFFKAI_LOG_LEVEL: 'warn'
    }
  });
}

let shutdownPromise;
function stop(signal) {
  shutdownPromise ??= (async () => {
    for (const app of apps) {
      if (app.exitCode === null && app.signalCode === null) {
        const exited = once(app, 'exit');
        app.kill(signal);
        await exited;
      }
    }
    await rm(directory, { recursive: true, force: true });
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
