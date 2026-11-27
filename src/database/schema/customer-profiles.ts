import { sql } from 'drizzle-orm';
import {
  check,
  index,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { customers } from './customers.js';
import { appSchema } from './schema.js';
import { tenants } from './tenants.js';

/**
 * Per-tenant customer file. `app.customers` is a global auth realm (one login
 * shared by every business), so notes and consent cannot live there: they are
 * scoped to the tenant and identified by phone, which every booking carries
 * even for guests. `customerId` is set when the booking belongs to an account.
 */
export const customerProfiles = appSchema.table(
  'customer_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 40 }).notNull(),
    email: varchar('email', { length: 254 }),
    /** Internal notes; never exposed to the customer. */
    notes: varchar('notes', { length: 2000 }),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    /** Where the consent was recorded: `booking` or `panel`. */
    consentSource: varchar('consent_source', { length: 40 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('customer_profiles_tenant_phone_uq').on(
      table.tenantId,
      table.phone,
    ),
    // Postgres treats NULLs as distinct, so guest rows never collide here.
    uniqueIndex('customer_profiles_tenant_customer_uq').on(
      table.tenantId,
      table.customerId,
    ),
    index('customer_profiles_tenant_email_idx').on(table.tenantId, table.email),
    check(
      'customer_profiles_phone_length',
      sql`length(${table.phone}) between 6 and 40`,
    ),
    check(
      'customer_profiles_email_lowercase',
      sql`${table.email} is null or ${table.email} = lower(${table.email})`,
    ),
  ],
);

export type CustomerProfile = typeof customerProfiles.$inferSelect;
export type NewCustomerProfile = typeof customerProfiles.$inferInsert;
