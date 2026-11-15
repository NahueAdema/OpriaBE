import { z } from 'zod';
import { serviceDepositType } from '../database/schema/index.js';
import { depositValidationMessage } from './deposit.js';

const nameSchema = z.string().trim().min(2).max(120);
const descriptionSchema = z.string().trim().max(1000).nullable().optional();
const durationSchema = z.number().int().min(5).max(1440);
const bufferSchema = z.number().int().min(0).max(240);
const moneySchema = z.number().int().min(0).max(100_000_000);

export const createServiceSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    durationMinutes: durationSchema,
    /** Free time kept before and after an appointment. */
    bufferMinutes: bufferSchema.default(0),
    priceCents: moneySchema.default(0),
    depositType: z.enum(serviceDepositType.enumValues).default('none'),
    depositValue: moneySchema.default(0),
    active: z.boolean().default(true),
  })
  .superRefine((data, context) => {
    const message = depositValidationMessage(data);

    if (message) {
      context.addIssue({ code: 'custom', path: ['depositValue'], message });
    }
  });

export const updateServiceSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema,
    durationMinutes: durationSchema.optional(),
    bufferMinutes: bufferSchema.optional(),
    priceCents: moneySchema.optional(),
    depositType: z.enum(serviceDepositType.enumValues).optional(),
    depositValue: moneySchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

export const listServicesQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const serviceResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  priceCents: z.number().int(),
  depositType: z.enum(serviceDepositType.enumValues),
  depositValue: z.number().int(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
export type ServiceResponse = z.infer<typeof serviceResponseSchema>;
