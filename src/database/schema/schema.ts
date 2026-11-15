import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Business tables live in their own Postgres schema so extensions and
 * platform-managed objects (Neon, pgvector, ...) stay in `public`.
 */
export const appSchema = pgSchema('app');
