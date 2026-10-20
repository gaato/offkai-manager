import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/lib/server/db/schema.ts',
  dbCredentials: {
    url: process.env.OFFKAI_DATABASE_URL ?? 'postgres://localhost/offkai'
  },
  strict: true,
  verbose: true
});
