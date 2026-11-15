import { z } from 'zod';
import { parseDateKey } from './availability.js';

/**
 * Query for `GET /availability`. `date` is a calendar date in the tenant
 * timezone, not an instant, so the caller never has to know the offset.
 */
export const availabilityQuerySchema = z.object({
  serviceId: z.uuid().describe('Service to book'),
  date: z.iso
    .date()
    .describe('Calendar date in the tenant timezone')
    .refine((value) => {
      try {
        parseDateKey(value);

        return true;
      } catch {
        return false;
      }
    }, 'Invalid calendar date'),
  staffId: z
    .uuid()
    .optional()
    .describe('Restrict the result to one staff member'),
});

export const availabilitySlotSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** Staff members that can take the appointment at this time. */
  staffIds: z.array(z.uuid()),
});

export const availabilityResponseSchema = z.object({
  date: z.iso.date(),
  timezone: z.string(),
  serviceId: z.uuid(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  slots: z.array(availabilitySlotSchema),
});

const dateKeySchema = z.iso.date().refine((value) => {
  try {
    parseDateKey(value);

    return true;
  } catch {
    return false;
  }
}, 'Invalid calendar date');

/**
 * Range used by the public month calendar. Days are calendar dates in the
 * tenant timezone, so the caller does not have to deal with offsets.
 */
export const calendarQuerySchema = z
  .object({
    serviceId: z.uuid().describe('Service to book'),
    from: dateKeySchema.describe('First calendar date in the tenant timezone'),
    to: dateKeySchema.describe('Last calendar date in the tenant timezone'),
  })
  .refine((value) => value.from <= value.to, {
    message: 'from must be before or equal to to',
    path: ['to'],
  })
  .refine((value) => daysBetween(value.from, value.to) <= 62, {
    message: 'Range cannot exceed 62 days',
    path: ['to'],
  });

export const calendarDaySchema = z.object({
  date: z.iso.date(),
  available: z.boolean(),
  slots: z.number().int(),
});

export const calendarResponseSchema = z.object({
  timezone: z.string(),
  serviceId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
  days: z.array(calendarDaySchema),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;
export type AvailabilityResponse = z.infer<
  typeof availabilityResponseSchema
>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type CalendarDay = z.infer<typeof calendarDaySchema>;
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

function daysBetween(from: string, to: string): number {
  const start = parseDateKey(from);
  const end = parseDateKey(to);

  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      86_400_000,
  );
}
