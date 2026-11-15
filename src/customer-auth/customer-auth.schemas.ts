import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(320).pipe(z.email());

const phone = z
  .string()
  .trim()
  .min(6)
  .max(40)
  .regex(/^[+0-9][0-9\s()-]{5,39}$/, 'Use a valid phone number');

export const customerRegisterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  phone,
  password: z.string().min(8).max(128),
});

export const customerLoginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const customerRefreshSchema = z.object({
  refreshToken: z.string().min(20).max(256),
});

export const customerLogoutSchema = z.object({
  refreshToken: z.string().min(20).max(256),
  allDevices: z.boolean().default(false),
});

export const customerAuthResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  customer: z.object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    phone: z.string(),
  }),
});

export const customerMeSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  phone: z.string(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;
export type CustomerRefreshInput = z.infer<typeof customerRefreshSchema>;
export type CustomerLogoutInput = z.infer<typeof customerLogoutSchema>;
export type CustomerAuthResult = z.infer<typeof customerAuthResultSchema>;
export type CustomerMeResponse = z.infer<typeof customerMeSchema>;
