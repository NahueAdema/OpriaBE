import { z } from 'zod';
import {
  appointmentStatus,
  serviceDepositType,
} from '../database/schema/index.js';

const dateKeySchema = z.iso
  .date()
  .describe('Calendar date in the tenant timezone');

const timeSchema = z.iso
  .datetime({ offset: true })
  .describe('ISO 8601 instant with offset or Z');

export const appointmentStatusSchema = z.enum(appointmentStatus.enumValues);

export const appointmentResponseSchema = z.object({
  id: z.uuid(),
  status: appointmentStatusSchema,
  startsAt: timeSchema,
  endsAt: timeSchema,
  customerName: z.string(),
  customerPhone: z.string(),
  customerEmail: z.string().nullable(),
  notes: z.string().nullable(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  staffId: z.uuid(),
  staffName: z.string(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  priceCents: z.number().int(),
  depositType: z.enum(serviceDepositType.enumValues),
  depositValue: z.number().int(),
  statusReason: z.string().nullable(),
  statusChangedAt: timeSchema.nullable(),
  createdAt: timeSchema,
  updatedAt: timeSchema,
});

export const appointmentListResponseSchema = z.object({
  items: z.array(appointmentResponseSchema),
  total: z.number().int(),
});

export const listAppointmentsQuerySchema = z
  .object({
    from: timeSchema.optional(),
    to: timeSchema.optional(),
    status: appointmentStatusSchema.optional(),
    staffId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine((value) => (value.from === undefined) === (value.to === undefined), {
    message: 'from and to must be provided together',
    path: ['to'],
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      new Date(value.from) < new Date(value.to),
    { message: 'from must be before to', path: ['to'] },
  )
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      new Date(value.to).getTime() - new Date(value.from).getTime() <=
        120 * 86_400_000,
    { message: 'Range cannot exceed 120 days', path: ['to'] },
  );

export const appointmentIdParamsSchema = z.object({ id: z.uuid() });

export const updateAppointmentStatusSchema = z.object({
  status: z.enum([
    'confirmed',
    'rejected',
    'cancelled',
    'completed',
    'no_show',
  ]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Public booking input. `startsAt` must be one of the slots returned by the
 * availability endpoint; the service recomputes them before inserting.
 */
export const createAppointmentInputSchema = z.object({
  serviceId: z.uuid(),
  startsAt: timeSchema,
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().min(6).max(40),
  customerEmail: z.email().max(254).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type AppointmentResponse = z.infer<typeof appointmentResponseSchema>;
export type AppointmentListResponse = z.infer<
  typeof appointmentListResponseSchema
>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type AppointmentIdParams = z.infer<typeof appointmentIdParamsSchema>;
export type UpdateAppointmentStatusInput = z.infer<
  typeof updateAppointmentStatusSchema
>;
export type CreateAppointmentInput = z.infer<
  typeof createAppointmentInputSchema
>;

export { dateKeySchema };
