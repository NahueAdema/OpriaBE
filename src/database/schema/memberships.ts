import { index, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const membershipRole = appSchema.enum('membership_role', [
  'owner',
  'admin',
  'staff',
  'customer',
]);

export type MembershipRole = (typeof membershipRole.enumValues)[number];

/**
 * Join table between users and tenants. A user can belong to more than one
 * tenant (for example, someone who works at two businesses).
 */
export const memberships = appSchema.table(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull().default('staff'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('memberships_tenant_user_unique').on(
      table.tenantId,
      table.userId,
    ),
    index('memberships_user_idx').on(table.userId),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
