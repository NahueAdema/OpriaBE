import { sql } from 'drizzle-orm';
import {
  check,
  index,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { appSchema } from './schema.js';
import { tenants } from './tenants.js';

/**
 * Idempotency ledger for appointments created from the panel. The key is
 * scoped by tenant and the fingerprint detects accidental key reuse with a
 * different payload. A replay returns the original appointment, whose state
 * may have moved on since the first request.
 */
export const appointmentRequests = appSchema.table(
  'appointment_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    /** SHA-256 of the canonical request body. */
    requestFingerprint: varchar('request_fingerprint', {
      length: 64,
    }).notNull(),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('appointment_requests_tenant_key_uq').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    index('appointment_requests_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    check(
      'appointment_requests_key_length',
      sql`length(${table.idempotencyKey}) >= 8`,
    ),
  ],
);

export type AppointmentRequest = typeof appointmentRequests.$inferSelect;
export type NewAppointmentRequest = typeof appointmentRequests.$inferInsert;
