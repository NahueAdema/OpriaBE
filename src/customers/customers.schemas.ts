import { z } from 'zod';
import {
  appointmentStatus,
  serviceDepositType,
} from '../database/schema/index.js';

const timeSchema = z.iso
  .datetime({ offset: true })
  .describe('ISO 8601 instant with offset or Z');

export const customerListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .refine((value) => value === undefined || value.length >= 2, {
      message: 'Search term must have at least 2 characters',
    })
    .describe('Name, phone or email, at least 2 characters'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Phone is the stable key: every booking has one, including guest bookings. */
export const customerPhoneParamsSchema = z.object({
  phone: z.string().trim().min(6).max(40),
});

export const customerListItemSchema = z.object({
  phone: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  customerId: z.uuid().nullable(),
  profileId: z.uuid().nullable(),
  notes: z.string().nullable(),
  consentAt: timeSchema.nullable(),
  appointmentCount: z.number().int(),
  lastAppointmentAt: timeSchema.nullable(),
});

export const customerListResponseSchema = z.object({
  items: z.array(customerListItemSchema),
  total: z.number().int(),
});

export const customerHistorySchema = z.object({
  id: z.uuid(),
  status: z.enum(appointmentStatus.enumValues),
  startsAt: timeSchema,
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number().int(),
  depositType: z.enum(serviceDepositType.enumValues),
  depositValue: z.number().int(),
  notes: z.string().nullable(),
  statusReason: z.string().nullable(),
});

export const customerDetailSchema = customerListItemSchema.extend({
  history: z.array(customerHistorySchema),
});

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z
    .union([z.email().max(254), z.literal('')])
    .optional()
    .transform((value) => (value ? value.toLowerCase() : undefined)),
  notes: z.string().trim().max(2000).optional(),
  /** `true` grants consent, `false` revokes it, omitted keeps the current value. */
  consent: z.boolean().optional(),
});

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CustomerPhoneParams = z.infer<typeof customerPhoneParamsSchema>;
export type CustomerListItem = z.infer<typeof customerListItemSchema>;
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;
export type CustomerHistoryEntry = z.infer<typeof customerHistorySchema>;
export type CustomerDetail = z.infer<typeof customerDetailSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
