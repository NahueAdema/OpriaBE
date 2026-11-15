import { sql } from 'drizzle-orm';
import {
  check,
  index,
  smallint,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { staff } from './staff.js';
import { tenants } from './tenants.js';

/**
 * Weekly recurring availability. `weekday` uses ISO 8601: 1 = Monday,
 * 7 = Sunday. Times are wall-clock times in the tenant's timezone.
 */
export const workingHours = appSchema.table(
  'working_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('working_hours_staff_weekday_idx').on(table.staffId, table.weekday),
    uniqueIndex('working_hours_unique').on(
      table.staffId,
      table.weekday,
      table.startTime,
      table.endTime,
    ),
    check(
      'working_hours_weekday_range',
      sql`${table.weekday} between 1 and 7`,
    ),
    check('working_hours_time_order', sql`${table.startTime} < ${table.endTime}`),
  ],
);

export type WorkingHour = typeof workingHours.$inferSelect;
export type NewWorkingHour = typeof workingHours.$inferInsert;
