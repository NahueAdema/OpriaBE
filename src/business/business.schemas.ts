import { z } from 'zod';
import {
  cancellationDepositPolicy,
  tenantPlan,
  tenantStatus,
} from '../database/schema/index.js';

/** Slugs that would collide with platform routes (RN-05). */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'business',
  'dashboard',
  'docs',
  'health',
  'login',
  'me',
  'register',
  'services',
  'settings',
  'staff',
  'v1',
  'www',
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    'Use lowercase letters, digits and dashes',
  )
  .refine((value) => !RESERVED_SLUGS.has(value), 'This slug is reserved');

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA timezone');

const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.email())
  .nullable()
  .optional();

const contactPhoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[+0-9][0-9\s()-]{2,31}$/, 'Use a valid phone number')
  .nullable()
  .optional();

const logoUrlSchema = z.url().max(2048).nullable().optional();

export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: slugSchema.optional(),
    timezone: timezoneSchema.optional(),
    logoUrl: logoUrlSchema,
    address: z.string().trim().max(255).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    contactEmail: contactEmailSchema,
    contactPhone: contactPhoneSchema,
    cancellationHours: z.number().int().min(0).max(720).optional(),
    cancellationDepositPolicy: z
      .enum(cancellationDepositPolicy.enumValues)
      .optional(),
    bookingMinAdvanceMinutes: z
      .number()
      .int()
      .min(0)
      .max(43_200)
      .optional(),
    bookingMaxAdvanceDays: z.number().int().min(1).max(365).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

export const businessResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  plan: z.enum(tenantPlan.enumValues),
  status: z.enum(tenantStatus.enumValues),
  logoUrl: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  cancellationHours: z.number().int(),
  cancellationDepositPolicy: z.enum(cancellationDepositPolicy.enumValues),
  bookingMinAdvanceMinutes: z.number().int(),
  bookingMaxAdvanceDays: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type BusinessResponse = z.infer<typeof businessResponseSchema>;
