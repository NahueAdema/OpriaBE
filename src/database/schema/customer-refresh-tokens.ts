import { sql } from 'drizzle-orm';
import {
  check,
  index,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { customers } from './customers.js';

/**
 * Opaque refresh tokens for customer sessions. Mirrors `refresh_tokens` but is
 * scoped to a customer instead of a staff user + tenant.
 */
export const customerRefreshTokens = appSchema.table(
  'customer_refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('customer_refresh_tokens_hash_unique').on(table.tokenHash),
    index('customer_refresh_tokens_customer_idx').on(table.customerId),
    index('customer_refresh_tokens_family_idx').on(table.familyId),
    index('customer_refresh_tokens_expires_idx').on(table.expiresAt),
    check(
      'customer_refresh_tokens_expiry_after_creation',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export type CustomerRefreshToken =
  typeof customerRefreshTokens.$inferSelect;
export type NewCustomerRefreshToken =
  typeof customerRefreshTokens.$inferInsert;
