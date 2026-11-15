import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';

export const tenantPlan = appSchema.enum('tenant_plan', [
  'free',
  'pro',
  'business',
]);

export const tenantStatus = appSchema.enum('tenant_status', [
  'active',
  'suspended',
  'deleted',
]);

/** What happens to the deposit when the customer cancels late. */
export const cancellationDepositPolicy = appSchema.enum(
  'cancellation_deposit_policy',
  ['retain', 'refund'],
);

export const tenants = appSchema.table(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    /** URL identifier, unique across the whole platform (RN-05). */
    slug: varchar('slug', { length: 63 }).notNull(),
    timezone: varchar('timezone', { length: 64 })
      .notNull()
      .default('America/Argentina/Buenos_Aires'),
    plan: tenantPlan('plan').notNull().default('free'),
    status: tenantStatus('status').notNull().default('active'),
    logoUrl: varchar('logo_url', { length: 2048 }),
    address: varchar('address', { length: 255 }),
    /** City used by the public directory filters. */
    city: varchar('city', { length: 120 }),
    /** Always stored lowercased when present. */
    contactEmail: varchar('contact_email', { length: 320 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    /** Minimum notice (hours) for a free cancellation (RN-03). */
    cancellationHours: integer('cancellation_hours').notNull().default(24),
    cancellationDepositPolicy: cancellationDepositPolicy(
      'cancellation_deposit_policy',
    )
      .notNull()
      .default('retain'),
    /** How far in advance a customer may book (RF-NEG-03). */
    bookingMinAdvanceMinutes: integer('booking_min_advance_minutes')
      .notNull()
      .default(0),
    bookingMaxAdvanceDays: integer('booking_max_advance_days')
      .notNull()
      .default(90),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('tenants_slug_unique').on(table.slug),
    check(
      'tenants_slug_format',
      sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`,
    ),
    check(
      'tenants_cancellation_hours_non_negative',
      sql`${table.cancellationHours} >= 0`,
    ),
    check(
      'tenants_booking_min_advance_non_negative',
      sql`${table.bookingMinAdvanceMinutes} >= 0`,
    ),
    check(
      'tenants_booking_max_advance_positive',
      sql`${table.bookingMaxAdvanceDays} > 0`,
    ),
    check(
      'tenants_contact_email_lowercase',
      sql`${table.contactEmail} is null or ${table.contactEmail} = lower(${table.contactEmail})`,
    ),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type CancellationDepositPolicy =
  (typeof cancellationDepositPolicy.enumValues)[number];
