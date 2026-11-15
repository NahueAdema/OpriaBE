import { z } from 'zod';
import {
  appointmentStatus,
  serviceDepositType,
} from '../database/schema/index.js';

const timeSchema = z.iso.datetime({ offset: true });

export const customerAppointmentSchema = z.object({
  id: z.uuid(),
  status: z.enum(appointmentStatus.enumValues),
  startsAt: timeSchema,
  endsAt: timeSchema,
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number().int(),
  depositType: z.enum(serviceDepositType.enumValues),
  depositValue: z.number().int(),
  notes: z.string().nullable(),
  createdAt: timeSchema,
  /** Computed from the business policy at read time. */
  canCancel: z.boolean(),
  cancellationHours: z.number().int(),
  business: z.object({
    name: z.string(),
    slug: z.string(),
    city: z.string().nullable(),
    address: z.string().nullable(),
    logoUrl: z.string().nullable(),
    timezone: z.string(),
  }),
});

export const customerAppointmentListSchema = z.object({
  items: z.array(customerAppointmentSchema),
  total: z.number().int(),
});

export const listCustomerAppointmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const customerAppointmentIdParamsSchema = z.object({ id: z.uuid() });

export const createCustomerAppointmentSchema = z.object({
  businessSlug: z.string().trim().min(1).max(63),
  serviceId: z.uuid(),
  startsAt: timeSchema,
  notes: z.string().trim().max(500).optional(),
});

export type CustomerAppointment = z.infer<typeof customerAppointmentSchema>;
export type CustomerAppointmentList = z.infer<
  typeof customerAppointmentListSchema
>;
export type ListCustomerAppointmentsQuery = z.infer<
  typeof listCustomerAppointmentsQuerySchema
>;
export type CustomerAppointmentIdParams = z.infer<
  typeof customerAppointmentIdParamsSchema
>;
export type CreateCustomerAppointmentInput = z.infer<
  typeof createCustomerAppointmentSchema
>;
