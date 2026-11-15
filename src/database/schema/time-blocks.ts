import { sql } from 'drizzle-orm';
import {
  check,
  index,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { staff } from './staff.js';
import { tenants } from './tenants.js';

/**
 * One-off unavailable periods: vacations, breaks, appointments outside the
 * system (RF-SRV-04).
 */
export const timeBlocks = appSchema.table(
  'time_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('time_blocks_staff_range_idx').on(table.staffId, table.startsAt),
    check('time_blocks_time_order', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export type TimeBlock = typeof timeBlocks.$inferSelect;
export type NewTimeBlock = typeof timeBlocks.$inferInsert;
