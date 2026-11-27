import { z } from 'zod';
import { appointmentStatus } from '../database/schema/index.js';

export const actionTokenParamsSchema = z.object({
  token: z.string().trim().min(20).max(2048),
});

export const publicAppointmentActionResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(appointmentStatus.enumValues),
});

export type ActionTokenParams = z.infer<typeof actionTokenParamsSchema>;
export type PublicAppointmentActionResponse = z.infer<
  typeof publicAppointmentActionResponseSchema
>;
