import { z } from 'zod';
import { membershipRole } from '../database/schema/index.js';

const email = z.string().trim().toLowerCase().max(320).pipe(z.email());

const tenantSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    'Use lowercase letters, digits and dashes',
  );

export const roleSchema = z.enum(membershipRole.enumValues);

export const registerSchema = z.object({
  tenantName: z.string().trim().min(2).max(120),
  tenantSlug,
  name: z.string().trim().min(2).max(120),
  email,
  password: z.string().min(10).max(128),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  /** Required only when the user belongs to more than one tenant. */
  tenantSlug: tenantSlug.optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(256),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(256),
  allDevices: z.boolean().default(false),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(10).max(128),
    /**
     * Current refresh token. Its family is kept alive so the device that
     * changed the password does not have to sign in again.
     */
    refreshToken: z.string().min(20).max(256).optional(),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });

export const authResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
  }),
  tenant: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    role: roleSchema,
  }),
});

export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  isPlatformAdmin: z.boolean(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  memberships: z.array(
    z.object({
      tenant: z.object({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
        status: z.enum(['active', 'suspended', 'deleted']),
      }),
      role: roleSchema,
    }),
  ),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AuthResult = z.infer<typeof authResultSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
