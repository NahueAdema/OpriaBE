import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({
  email: z.email(),
  age: z.coerce.number().int().min(18),
});

describe('ZodValidationPipe', () => {
  it('returns the parsed output', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(pipe.transform({ email: 'ada@opria.app', age: '42' })).toEqual({
      email: 'ada@opria.app',
      age: 42,
    });
  });

  it('throws a BadRequestException carrying the issues', () => {
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ email: 'not-an-email', age: 12 });
      expect.unreachable('Expected the pipe to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);

      const response = (error as BadRequestException).getResponse();
      expect(response).toMatchObject({
        message: 'Request validation failed',
        errors: [
          { path: 'email' },
          { path: 'age' },
        ],
      });
    }
  });
});
