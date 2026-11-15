import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toOpenApiParameters, toOpenApiSchema } from './zod-openapi.js';

const schema = z.object({
  email: z.email(),
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().optional().describe('Free-text search'),
});

describe('zod-openapi', () => {
  it('converts an object schema to an OpenAPI 3.0 input schema', () => {
    const document = toOpenApiSchema(schema);

    expect(document).toMatchObject({
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
        page: { type: 'integer', minimum: 1 },
      },
    });
    expect(document).not.toHaveProperty('$schema');
  });

  it('expands object properties into parameters', () => {
    expect(toOpenApiParameters(schema)).toEqual([
      {
        name: 'email',
        required: true,
        schema: expect.objectContaining({ type: 'string' }),
        description: undefined,
      },
      {
        name: 'page',
        required: false,
        schema: expect.objectContaining({ type: 'integer' }),
        description: undefined,
      },
      {
        name: 'search',
        required: false,
        schema: expect.objectContaining({ type: 'string' }),
        description: 'Free-text search',
      },
    ]);
  });
});
