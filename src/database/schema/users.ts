import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';

export const users = appSchema.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Always stored lowercased: the CHECK below enforces it, which together
     * with the unique index makes email uniqueness case-insensitive.
     */
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    /** Platform staff: can manage tenants, plans and support. */
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
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
    uniqueIndex('users_email_unique').on(table.email),
    check('users_email_lowercase', sql`${table.email} = lower(${table.email})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
