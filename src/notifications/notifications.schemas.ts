import { z } from 'zod';

export const processNotificationsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const processNotificationsResponseSchema = z.object({
  processed: z.number().int(),
  failed: z.number().int(),
});

export type ProcessNotificationsInput = z.infer<
  typeof processNotificationsSchema
>;
export type ProcessNotificationsResponse = z.infer<
  typeof processNotificationsResponseSchema
>;
