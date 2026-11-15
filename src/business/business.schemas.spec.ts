import { describe, expect, it } from 'vitest';
import {
  RESERVED_SLUGS,
  slugSchema,
  timezoneSchema,
  updateBusinessSchema,
} from './business.schemas.js';

describe('business schemas', () => {
  it('accepts a valid IANA timezone', () => {
    expect(
      timezoneSchema.safeParse('America/Argentina/Buenos_Aires').success,
    ).toBe(true);
  });

  it('rejects an unknown timezone', () => {
    expect(timezoneSchema.safeParse('Mars/Olympus_Mons').success).toBe(false);
  });

  it('normalizes slugs to lowercase', () => {
    expect(slugSchema.parse('  My-Business ')).toBe('my-business');
  });

  it('rejects reserved slugs', () => {
    for (const slug of RESERVED_SLUGS) {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    }
  });

  it('rejects malformed slugs', () => {
    for (const slug of ['-leading', 'trailing-', 'has space', '']) {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    }
  });

  it('rejects an empty update payload', () => {
    expect(updateBusinessSchema.safeParse({}).success).toBe(false);
  });

  it('lowercases contact emails', () => {
    expect(
      updateBusinessSchema.parse({ contactEmail: 'Owner@Example.COM' })
        .contactEmail,
    ).toBe('owner@example.com');
  });

  it('accepts null to clear optional contact fields', () => {
    const result = updateBusinessSchema.safeParse({
      contactEmail: null,
      contactPhone: null,
      address: null,
      logoUrl: null,
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid phone number', () => {
    expect(
      updateBusinessSchema.safeParse({ contactPhone: 'not-a-phone' }).success,
    ).toBe(false);
  });

  it('rejects negative cancellation hours', () => {
    expect(
      updateBusinessSchema.safeParse({ cancellationHours: -1 }).success,
    ).toBe(false);
  });
});
