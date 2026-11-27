import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { appSchema } from './schema.js';
import { tenants } from './tenants.js';

export const notificationJobStatus = appSchema.enum('notification_job_status', [
  'pending',
  'done',
  'failed',
]);

/** What the worker needs to render and send a message, without extra lookups. */
export interface NotificationPayload {
  appointmentId?: string;
  customerName?: string;
  businessName?: string;
  serviceName?: string;
  staffName?: string;
  timezone?: string;
  reason?: string;
  startsAt?: string;
  /** Signed, short-lived link rendered into the email body. */
  actionUrl?: string;
  [key: string]: unknown;
}

/**
 * Durable outbox for F3. The domain enqueues rows in the same transaction that
 * creates or changes an appointment; the worker claims them with SKIP LOCKED.
 */
export const notificationJobs = appSchema.table(
  'notification_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Links the outbox to its appointment so reminders can be cancelled. */
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'cascade',
    }),
    /** e.g. appointment_confirmation, appointment_reminder_24h. */
    type: varchar('type', { length: 80 }).notNull(),
    recipient: varchar('recipient', { length: 254 }).notNull(),
    payload: jsonb('payload').$type<NotificationPayload>().notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: notificationJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Earliest instant the worker may retry a failed attempt (UTC). */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /** Idempotency key, usually `${appointmentId}:${type}:${scheduledAt}`. */
    dedupeKey: varchar('dedupe_key', { length: 200 }).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: varchar('last_error', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('notification_jobs_dedupe_key_uq').on(table.dedupeKey),
    index('notification_jobs_appointment_idx').on(
      table.appointmentId,
      table.type,
    ),
    index('notification_jobs_tenant_scheduled_idx').on(
      table.tenantId,
      table.scheduledAt,
    ),
    index('notification_jobs_status_scheduled_idx').on(
      table.status,
      table.scheduledAt,
    ),
    index('notification_jobs_locked_at_idx').on(table.lockedAt),
    check(
      'notification_jobs_attempts_non_negative',
      sql`${table.attempts} >= 0`,
    ),
  ],
);

export type NotificationJob = typeof notificationJobs.$inferSelect;
export type NewNotificationJob = typeof notificationJobs.$inferInsert;
export type NotificationJobStatus =
  (typeof notificationJobStatus.enumValues)[number];
