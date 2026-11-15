import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { tenants } from './tenants.js';

export const serviceDepositType = appSchema.enum('service_deposit_type', [
  'none',
  'fixed',
  'percentage',
]);

/**
 * A bookable service. Money is stored in minor units (cents) to avoid
 * floating-point rounding.
 */
export const services = appSchema.table(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    durationMinutes: integer('duration_minutes').notNull(),
    /** Preparation time kept free before and after an appointment (RF-SRV-05). */
    bufferMinutes: integer('buffer_minutes').notNull().default(0),
    priceCents: integer('price_cents').notNull().default(0),
    depositType: serviceDepositType('deposit_type').notNull().default('none'),
    /** Cents when `fixed`, 0-100 when `percentage`, 0 when `none`. */
    depositValue: integer('deposit_value').notNull().default(0),
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
    index('services_tenant_active_idx').on(table.tenantId, table.active),
    check('services_duration_positive', sql`${table.durationMinutes} > 0`),
    check(
      'services_buffer_range',
      sql`${table.bufferMinutes} between 0 and 240`,
    ),
    check('services_price_non_negative', sql`${table.priceCents} >= 0`),
    check(
      'services_deposit_value_non_negative',
      sql`${table.depositValue} >= 0`,
    ),
    check(
      'services_percentage_deposit_range',
      sql`${table.depositType} <> 'percentage' or ${table.depositValue} <= 100`,
    ),
    check(
      'services_none_deposit_zero',
      sql`${table.depositType} <> 'none' or ${table.depositValue} = 0`,
    ),
  ],
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type ServiceDepositType = (typeof serviceDepositType.enumValues)[number];
