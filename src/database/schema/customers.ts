import { sql } from 'drizzle-orm';
import {
  check,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';

/**
 * Client accounts. They are deliberately separate from `users` (tenant staff):
 * a customer is not tied to a business, does not have memberships and cannot
 * access the business panel. Emails are unique per realm, so the same person
 * may own a business account and a customer account.
 */
export const customers = appSchema.table(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Always stored lowercased, like `users.email`. */
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 40 }).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('customers_email_unique').on(table.email),
    check(
      'customers_email_lowercase',
      sql`${table.email} = lower(${table.email})`,
    ),
    check(
      'customers_phone_length',
      sql`length(${table.phone}) between 6 and 40`,
    ),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
