import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { customers } from './customers.js';
import { serviceDepositType, services } from './services.js';
import { staff } from './staff.js';
import { tenants } from './tenants.js';

export const appointmentStatus = appSchema.enum('appointment_status', [
  'pending',
  'confirmed',
  'rejected',
  'cancelled',
  'completed',
  'no_show',
]);

/**
 * A booking request. Service, staff, price and deposit are snapshotted so the
 * history does not change when the business edits or deactivates them later.
 *
 * `pending` and `confirmed` block their time range; the rest of the statuses
 * release it. The hard anti-double-booking guard is the Postgres exclusion
 * constraint added in the `appointments_no_overlap` migration.
 */
export const appointments = appSchema.table(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'restrict' }),
    /** Set when a signed-in customer books; guest bookings leave it null. */
    customerId: uuid('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    customerName: varchar('customer_name', { length: 120 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 40 }).notNull(),
    /** Always stored lowercased when present. */
    customerEmail: varchar('customer_email', { length: 254 }),
    notes: varchar('notes', { length: 500 }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    bufferMinutes: integer('buffer_minutes').notNull().default(0),
    serviceName: varchar('service_name', { length: 120 }).notNull(),
    staffName: varchar('staff_name', { length: 120 }).notNull(),
    priceCents: integer('price_cents').notNull().default(0),
    depositType: serviceDepositType('deposit_type').notNull().default('none'),
    depositValue: integer('deposit_value').notNull().default(0),
    status: appointmentStatus('status').notNull().default('pending'),
    /** Why the business rejected or cancelled the appointment. */
    statusReason: varchar('status_reason', { length: 500 }),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('appointments_tenant_starts_at_idx').on(
      table.tenantId,
      table.startsAt,
    ),
    index('appointments_tenant_status_starts_at_idx').on(
      table.tenantId,
      table.status,
      table.startsAt,
    ),
    index('appointments_staff_starts_at_idx').on(
      table.staffId,
      table.startsAt,
    ),
    index('appointments_customer_starts_at_idx').on(
      table.customerId,
      table.startsAt,
    ),
    check('appointments_time_order', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'appointments_duration_positive',
      sql`${table.durationMinutes} > 0`,
    ),
    check(
      'appointments_buffer_range',
      sql`${table.bufferMinutes} between 0 and 240`,
    ),
    check('appointments_price_non_negative', sql`${table.priceCents} >= 0`),
    check(
      'appointments_deposit_value_non_negative',
      sql`${table.depositValue} >= 0`,
    ),
    check(
      'appointments_customer_email_lowercase',
      sql`${table.customerEmail} is null or ${table.customerEmail} = lower(${table.customerEmail})`,
    ),
  ],
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number];
