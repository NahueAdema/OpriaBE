import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery } from './zod.decorators.js';

/** Swagger stores method parameter metadata under this key. */
const API_PARAMETERS = 'swagger/apiParameters';

interface SwaggerParameter {
  in: string;
  name?: string;
  required?: boolean;
}

function readParameters(target: object, propertyKey: string): SwaggerParameter[] {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);

  return (
    (Reflect.getMetadata(API_PARAMETERS, descriptor?.value) as
      | SwaggerParameter[]
      | undefined) ?? []
  );
}

describe('zod parameter decorators', () => {
  it('documents a body even when it is not the first parameter', () => {
    class Controller {
      handler(_user: unknown, _body: unknown): void {}
    }

    const apply = ZodBody(z.object({ name: z.string() }));

    // Regression: ApiBody is a method decorator; passing the parameter index
    // as its descriptor used to throw for any index greater than zero.
    expect(() => apply(Controller.prototype, 'handler', 1)).not.toThrow();

    expect(readParameters(Controller.prototype, 'handler')).toEqual([
      expect.objectContaining({ in: 'body', required: true }),
    ]);
  });

  it('documents query parameters at any position', () => {
    class Controller {
      handler(_user: unknown, _query: unknown): void {}
    }

    ZodQuery(
      z.object({
        active: z.enum(['true', 'false']).optional(),
        page: z.coerce.number().int().default(1),
      }),
    )(Controller.prototype, 'handler', 1);

    expect(readParameters(Controller.prototype, 'handler')).toEqual([
      expect.objectContaining({ in: 'query', name: 'active' }),
      expect.objectContaining({ in: 'query', name: 'page' }),
    ]);
  });

  it('documents path parameters as required at any position', () => {
    class Controller {
      handler(_user: unknown, _params: unknown): void {}
    }

    ZodParam(z.object({ id: z.uuid() }))(Controller.prototype, 'handler', 1);

    expect(readParameters(Controller.prototype, 'handler')).toEqual([
      expect.objectContaining({ in: 'path', name: 'id', required: true }),
    ]);
  });
});
