import { index, integer, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { notificationJobs } from './notification-jobs.js';
import { tenants } from './tenants.js';

export const notificationLogOutcome = appSchema.enum(
  'notification_log_outcome',
  ['sent', 'failed'],
);

/**
 * Append-only audit trail: one row per delivery attempt, including failures
 * and the reason. `notification_jobs.last_error` keeps only the latest state.
 */
export const notificationLog = appSchema.table(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => notificationJobs.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 80 }).notNull(),
    recipient: varchar('recipient', { length: 254 }).notNull(),
    outcome: notificationLogOutcome('outcome').notNull(),
    attempt: integer('attempt').notNull(),
    error: varchar('error', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('notification_log_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    index('notification_log_job_idx').on(table.jobId),
  ],
);

export type NotificationLogEntry = typeof notificationLog.$inferSelect;
export type NewNotificationLogEntry = typeof notificationLog.$inferInsert;
