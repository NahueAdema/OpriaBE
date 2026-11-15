import { describe, expect, it } from 'vitest';
import { depositValidationMessage } from './deposit.js';
import { createServiceSchema, updateServiceSchema } from './services.schemas.js';

describe('depositValidationMessage', () => {
  it('accepts no deposit with a zero value', () => {
    expect(
      depositValidationMessage({
        depositType: 'none',
        depositValue: 0,
        priceCents: 10_000,
      }),
    ).toBeUndefined();
  });

  it('rejects a non-zero value when there is no deposit', () => {
    expect(
      depositValidationMessage({
        depositType: 'none',
        depositValue: 500,
        priceCents: 10_000,
      }),
    ).toContain('must be 0');
  });

  it('accepts a fixed deposit up to the service price', () => {
    expect(
      depositValidationMessage({
        depositType: 'fixed',
        depositValue: 10_000,
        priceCents: 10_000,
      }),
    ).toBeUndefined();
  });

  it('rejects a fixed deposit above the service price', () => {
    expect(
      depositValidationMessage({
        depositType: 'fixed',
        depositValue: 10_001,
        priceCents: 10_000,
      }),
    ).toContain('cannot exceed');
  });

  it('accepts percentage deposits between 0 and 100', () => {
    for (const depositValue of [0, 25, 100]) {
      expect(
        depositValidationMessage({
          depositType: 'percentage',
          depositValue,
          priceCents: 10_000,
        }),
      ).toBeUndefined();
    }
  });

  it('rejects percentage deposits outside 0-100', () => {
    expect(
      depositValidationMessage({
        depositType: 'percentage',
        depositValue: 101,
        priceCents: 10_000,
      }),
    ).toContain('between 0 and 100');
  });
});

describe('service schemas', () => {
  it('applies the defaults for a minimal service', () => {
    expect(
      createServiceSchema.parse({ name: 'Haircut', durationMinutes: 30 }),
    ).toEqual({
      name: 'Haircut',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 0,
      depositType: 'none',
      depositValue: 0,
      active: true,
    });
  });

  it('rejects an invalid deposit combination on create', () => {
    const result = createServiceSchema.safeParse({
      name: 'Haircut',
      durationMinutes: 30,
      priceCents: 1_000,
      depositType: 'fixed',
      depositValue: 2_000,
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['depositValue']);
    }
  });

  it('rejects an empty update payload', () => {
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a partial update', () => {
    expect(updateServiceSchema.safeParse({ active: false }).success).toBe(true);
  });
});
