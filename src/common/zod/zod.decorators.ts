import { Body, Param, Query } from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, type SchemaObject } from '@nestjs/swagger';
import type { z } from 'zod';
import { toOpenApiParameters, toOpenApiSchema } from './zod-openapi.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

type SwaggerMethodDecorator = (
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
) => void;

/**
 * Swagger's `ApiBody`, `ApiQuery` and `ApiParam` are method decorators, but
 * Nest parameter decorators receive the parameter index as their third
 * argument. Applying them directly would treat that index as a property
 * descriptor and crash (or silently skip the metadata) for every parameter
 * after the first. We look up the real descriptor of the handler instead.
 */
function applyToMethod(
  decorator: SwaggerMethodDecorator,
  target: object,
  propertyKey: string | symbol | undefined,
): void {
  if (propertyKey === undefined) {
    return;
  }

  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);

  if (descriptor) {
    decorator(target, propertyKey, descriptor);
  }
}

/**
 * Validates the request body with a Zod schema and documents it in Swagger.
 *
 * ```ts
 * @Post()
 * create(@ZodBody(createAppointmentSchema) body: CreateAppointmentInput) {}
 * ```
 */
export function ZodBody<TSchema extends z.ZodType>(
  schema: TSchema,
  description?: string,
): ParameterDecorator {
  const pipe = new ZodValidationPipe(schema);
  const apiBody = ApiBody({
    schema: toOpenApiSchema(schema) as SchemaObject,
    description,
  }) as unknown as SwaggerMethodDecorator;

  return (target, propertyKey, parameterIndex) => {
    Body(pipe)(target, propertyKey, parameterIndex);
    applyToMethod(apiBody, target, propertyKey);
  };
}

/**
 * Validates the query string with an object Zod schema. Each property becomes
 * its own Swagger query parameter.
 */
export function ZodQuery<TSchema extends z.ZodType>(
  schema: TSchema,
): ParameterDecorator {
  const pipe = new ZodValidationPipe(schema);
  const parameters = toOpenApiParameters(schema).map(
    (parameter) =>
      ApiQuery({
        ...parameter,
        schema: parameter.schema as SchemaObject,
      }) as unknown as SwaggerMethodDecorator,
  );

  return (target, propertyKey, parameterIndex) => {
    Query(pipe)(target, propertyKey, parameterIndex);

    for (const parameter of parameters) {
      applyToMethod(parameter, target, propertyKey);
    }
  };
}

/**
 * Validates the route parameters with an object Zod schema. Path parameters
 * are always required in OpenAPI, regardless of the schema.
 */
export function ZodParam<TSchema extends z.ZodType>(
  schema: TSchema,
): ParameterDecorator {
  const pipe = new ZodValidationPipe(schema);
  const parameters = toOpenApiParameters(schema).map(
    (parameter) =>
      ApiParam({
        ...parameter,
        required: true,
        schema: parameter.schema as SchemaObject,
      }) as unknown as SwaggerMethodDecorator,
  );

  return (target, propertyKey, parameterIndex) => {
    Param(pipe)(target, propertyKey, parameterIndex);

    for (const parameter of parameters) {
      applyToMethod(parameter, target, propertyKey);
    }
  };
}
