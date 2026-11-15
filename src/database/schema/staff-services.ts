import {
  index,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './schema.js';
import { services } from './services.js';
import { staff } from './staff.js';
import { tenants } from './tenants.js';

/** Which services a staff member performs (RF-SRV-02). */
export const staffServices = appSchema.table(
  'staff_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('staff_services_unique').on(table.staffId, table.serviceId),
    index('staff_services_tenant_service_idx').on(
      table.tenantId,
      table.serviceId,
    ),
  ],
);

export type StaffService = typeof staffServices.$inferSelect;
export type NewStaffService = typeof staffServices.$inferInsert;
