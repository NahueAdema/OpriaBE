import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: 'Must be a postgres:// or postgresql:// connection string',
  });

/**
 * Single source of truth for environment configuration.
 *
 * Every variable the app reads must be declared here. `ConfigModule` calls
 * `validateEnv` once at boot, so a missing or malformed value fails fast
 * instead of surfacing as a runtime bug deep inside a request.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().min(1).default('0.0.0.0'),
  API_PREFIX: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes')
    .default('v1'),
  CORS_ORIGINS: csv,
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SWAGGER_ENABLED: booleanish.optional(),
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  DATABASE_URL: postgresUrl,
  /** Unpooled connection used by migrations. Defaults to DATABASE_URL. */
  DATABASE_URL_DIRECT: postgresUrl.optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  JWT_ISSUER: z.string().min(1).default('opria'),
  JWT_AUDIENCE: z.string().min(1).default('opria-api'),
  /**
   * Optional overrides. When absent, notification secrets are derived from
   * JWT_ACCESS_SECRET with domain separation, so existing deployments keep
   * working without new secrets. Set them explicitly in production.
   */
  NOTIFICATION_SIGNING_SECRET: z.string().min(32).optional(),
  NOTIFICATION_WORKER_SECRET: z.string().min(32).optional(),
  ACTION_LINK_TTL_HOURS: z.coerce.number().int().positive().default(168),
  /** Absolute base URL used to build one-click links in emails. */
  PUBLIC_API_URL: z.url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment variables:\n${details}`);
}
