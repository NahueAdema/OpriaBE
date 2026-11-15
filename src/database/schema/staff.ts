import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/**
 * A person who delivers services. The link to a user account is optional:
 * staff can exist before an invitation is accepted (RF-AUT-07, phase 2).
 */
export const staff = appSchema.table(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 120 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('staff_tenant_active_idx').on(table.tenantId, table.active),
    uniqueIndex('staff_tenant_user_unique')
      .on(table.tenantId, table.userId)
      .where(sql`${table.userId} is not null`),
  ],
);

export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;
