import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  out: './drizzle',
  schema: './src/lib/server/db/schema.ts',
  dbCredentials: {
    url: process.env.OFFKAI_DATABASE_PATH ?? './offkai.sqlite'
  },
  strict: true,
  verbose: true
});
