import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://opria:opria@127.0.0.1:5433/opria',
  JWT_ACCESS_SECRET: 'test-secret-with-at-least-32-characters!!',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.API_PREFIX).toBe('v1');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.SWAGGER_ENABLED).toBeUndefined();
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_URL_DIRECT).toBeUndefined();
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
    expect(env.JWT_ISSUER).toBe('opria');
    expect(env.JWT_AUDIENCE).toBe('opria-api');
  });

  it('parses comma-separated lists and boolean flags', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGINS: 'http://localhost:3000, https://app.opria.app',
      SWAGGER_ENABLED: 'false',
    });

    expect(env.CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://app.opria.app',
    ]);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('requires a Postgres connection string', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: 'mysql://localhost/opria' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => validateEnv({ ...base, PORT: '0' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });
});
