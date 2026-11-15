import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url =
  process.env.DATABASE_URL_DIRECT ??
  process.env.DATABASE_URL ??
  'postgres://opria:opria@127.0.0.1:5433/opria';

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Only manage our own schema; never touch public/Neon internals.
  schemaFilter: ['app'],
  strict: true,
  verbose: true,
  dbCredentials: { url },
});
