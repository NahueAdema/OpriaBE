import { z } from 'zod';
import { workingHoursOverlapIssues } from './working-hours.js';

const nameSchema = z.string().trim().min(2).max(120);

export const createStaffSchema = z.object({
  name: nameSchema,
  /** Optional link to an existing user account in this tenant. */
  userId: z.uuid().nullable().optional(),
  active: z.boolean().default(true),
});

export const updateStaffSchema = z
  .object({
    name: nameSchema.optional(),
    userId: z.uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

export const listStaffQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const setStaffServicesSchema = z.object({
  serviceIds: z.array(z.uuid()).max(200).default([]),
});

export const staffServiceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});

export const staffResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  userId: z.uuid().nullable(),
  active: z.boolean(),
  services: z.array(staffServiceSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const staffServicesResponseSchema = z.object({
  services: z.array(staffServiceSchema),
});

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM in 24-hour format');

export const workingHourEntrySchema = z
  .object({
    /** ISO 8601 weekday: 1 = Monday, 7 = Sunday. */
    weekday: z.number().int().min(1).max(7),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
  })
  .refine((entry) => entry.startTime < entry.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });

export const replaceWorkingHoursSchema = z
  .object({
    hours: z.array(workingHourEntrySchema).max(50).default([]),
  })
  .superRefine((data, context) => {
    for (const issue of workingHoursOverlapIssues(data.hours)) {
      context.addIssue({
        code: 'custom',
        path: issue.path,
        message: issue.message,
      });
    }
  });

export const workingHourResponseSchema = z.object({
  id: z.uuid(),
  weekday: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
});

export const workingHoursResponseSchema = z.object({
  hours: z.array(workingHourResponseSchema),
});

export const createTimeBlockSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(255).nullable().optional(),
  })
  .refine(
    (data) =>
      new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime(),
    { message: 'endsAt must be after startsAt', path: ['endsAt'] },
  );

export const listTimeBlocksQuerySchema = z.object({
  /** Return blocks that overlap this ISO datetime range. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const timeBlockResponseSchema = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;
export type SetStaffServicesInput = z.infer<typeof setStaffServicesSchema>;
export type StaffResponse = z.infer<typeof staffResponseSchema>;
export type ReplaceWorkingHoursInput = z.infer<
  typeof replaceWorkingHoursSchema
>;
export type WorkingHoursResponse = z.infer<typeof workingHoursResponseSchema>;
export type CreateTimeBlockInput = z.infer<typeof createTimeBlockSchema>;
export type ListTimeBlocksQuery = z.infer<typeof listTimeBlocksQuerySchema>;
export type TimeBlockResponse = z.infer<typeof timeBlockResponseSchema>;
