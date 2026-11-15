import { relations } from 'drizzle-orm';
import { appointments } from './appointments.js';
import { customerRefreshTokens } from './customer-refresh-tokens.js';
import { customers } from './customers.js';
import { memberships } from './memberships.js';
import { refreshTokens } from './refresh-tokens.js';
import { services } from './services.js';
import { staff } from './staff.js';
import { staffServices } from './staff-services.js';
import { tenants } from './tenants.js';
import { timeBlocks } from './time-blocks.js';
import { users } from './users.js';
import { workingHours } from './working-hours.js';

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  refreshTokens: many(refreshTokens),
  services: many(services),
  staff: many(staff),
  appointments: many(appointments),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  refreshTokens: many(refreshTokens),
  staffProfiles: many(staff),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  refreshTokens: many(customerRefreshTokens),
  appointments: many(appointments),
}));

export const customerRefreshTokensRelations = relations(
  customerRefreshTokens,
  ({ one }) => ({
    customer: one(customers, {
      fields: [customerRefreshTokens.customerId],
      references: [customers.id],
    }),
  }),
);

export const membershipsRelations = relations(memberships, ({ one }) => ({
  tenant: one(tenants, {
    fields: [memberships.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [refreshTokens.tenantId],
    references: [tenants.id],
  }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [services.tenantId],
    references: [tenants.id],
  }),
  staffServices: many(staffServices),
  appointments: many(appointments),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [staff.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [staff.userId],
    references: [users.id],
  }),
  staffServices: many(staffServices),
  workingHours: many(workingHours),
  timeBlocks: many(timeBlocks),
  appointments: many(appointments),
}));

export const staffServicesRelations = relations(staffServices, ({ one }) => ({
  tenant: one(tenants, {
    fields: [staffServices.tenantId],
    references: [tenants.id],
  }),
  staff: one(staff, {
    fields: [staffServices.staffId],
    references: [staff.id],
  }),
  service: one(services, {
    fields: [staffServices.serviceId],
    references: [services.id],
  }),
}));

export const workingHoursRelations = relations(workingHours, ({ one }) => ({
  tenant: one(tenants, {
    fields: [workingHours.tenantId],
    references: [tenants.id],
  }),
  staff: one(staff, {
    fields: [workingHours.staffId],
    references: [staff.id],
  }),
}));

export const appointmentsRelations = relations(
  appointments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [appointments.tenantId],
      references: [tenants.id],
    }),
    service: one(services, {
      fields: [appointments.serviceId],
      references: [services.id],
    }),
    staff: one(staff, {
      fields: [appointments.staffId],
      references: [staff.id],
    }),
    customer: one(customers, {
      fields: [appointments.customerId],
      references: [customers.id],
    }),
  }),
);

export const timeBlocksRelations = relations(timeBlocks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [timeBlocks.tenantId],
    references: [tenants.id],
  }),
  staff: one(staff, {
    fields: [timeBlocks.staffId],
    references: [staff.id],
  }),
}));
