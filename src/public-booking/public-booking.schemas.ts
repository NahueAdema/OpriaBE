import { z } from 'zod';
import {
  appointmentStatus,
  cancellationDepositPolicy,
  serviceDepositType,
} from '../database/schema/index.js';
import { parseDateKey } from '../availability/availability.js';

const dateKeySchema = z.iso.date().refine((value) => {
  try {
    parseDateKey(value);

    return true;
  } catch {
    return false;
  }
}, 'Invalid calendar date');

const timeSchema = z.iso.datetime({ offset: true });

export const searchBusinessesQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .refine((value) => value === undefined || value.length >= 2, {
      message: 'Search term must have at least 2 characters',
    })
    .describe('Business name or slug, at least 2 characters'),
  city: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  service: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .describe('Service name offered by the business'),
});

export const publicBusinessFiltersSchema = z.object({
  cities: z.array(z.string()),
  services: z.array(z.string()),
});

export const slugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(63),
});

export const publicAvailabilityQuerySchema = z.object({
  serviceId: z.uuid(),
  date: dateKeySchema.describe('Calendar date in the tenant timezone'),
});

export const publicBusinessSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  logoUrl: z.string().nullable(),
  serviceCount: z.number().int(),
});

export const publicBusinessListSchema = z.object({
  items: z.array(publicBusinessSummarySchema),
});

export const publicServiceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  priceCents: z.number().int(),
  depositType: z.enum(serviceDepositType.enumValues),
  depositValue: z.number().int(),
});

export const publicBusinessSchema = z.object({
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  logoUrl: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  cancellationHours: z.number().int(),
  cancellationDepositPolicy: z.enum(cancellationDepositPolicy.enumValues),
  bookingMinAdvanceMinutes: z.number().int(),
  bookingMaxAdvanceDays: z.number().int(),
  services: z.array(publicServiceSchema),
});

export const publicAvailabilitySlotSchema = z.object({
  startsAt: timeSchema,
  endsAt: timeSchema,
});

export const publicAvailabilitySchema = z.object({
  date: z.iso.date(),
  timezone: z.string(),
  serviceId: z.uuid(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  slots: z.array(publicAvailabilitySlotSchema),
});

export const publicAppointmentSchema = z.object({
  id: z.uuid(),
  status: z.enum(appointmentStatus.enumValues),
  startsAt: timeSchema,
  endsAt: timeSchema,
  serviceName: z.string(),
  staffName: z.string(),
  priceCents: z.number().int(),
  depositType: z.enum(serviceDepositType.enumValues),
  depositValue: z.number().int(),
  customerName: z.string(),
  business: z.object({
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
  }),
});

export type SearchBusinessesQuery = z.infer<
  typeof searchBusinessesQuerySchema
>;
export type SlugParams = z.infer<typeof slugParamsSchema>;
export type PublicAvailabilityQuery = z.infer<
  typeof publicAvailabilityQuerySchema
>;
export type PublicBusinessList = z.infer<typeof publicBusinessListSchema>;
export type PublicBusinessFilters = z.infer<
  typeof publicBusinessFiltersSchema
>;
export type PublicBusiness = z.infer<typeof publicBusinessSchema>;
export type PublicAvailability = z.infer<typeof publicAvailabilitySchema>;
export type PublicAppointment = z.infer<typeof publicAppointmentSchema>;
