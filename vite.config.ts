import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repository = process.env.SOURCE_REPOSITORY ?? '';
const revision = process.env.VCS_REF ?? '';
const aliases = {
  $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
};

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    alias: aliases
  },
  define: {
    __SOURCE_REPOSITORY__: JSON.stringify(repository),
    __VCS_REF__: JSON.stringify(revision)
  },
  test: {
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'unit',
          setupFiles: ['tests/clock.ts'],
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'scenario',
          setupFiles: ['tests/clock.ts', 'tests/support/scenario-setup.ts'],
          include: ['tests/scenario/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false
        }
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'integration',
          isolate: false,
          setupFiles: ['tests/clock.ts'],
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 120_000
        }
      }
    ]
  }
});
