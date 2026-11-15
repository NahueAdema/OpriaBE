import { z } from 'zod';

export type OpenApiSchemaObject = Record<string, unknown>;

export interface OpenApiParameter {
  name: string;
  required: boolean;
  schema: OpenApiSchemaObject;
  description?: string;
}

/**
 * Converts a Zod schema into an OpenAPI 3.0 schema object.
 *
 * `io: 'input'` describes what clients send (defaults and transforms are not
 * applied), which is what request bodies and query parameters need.
 */
export function toOpenApiSchema(schema: z.ZodType): OpenApiSchemaObject {
  const document = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as OpenApiSchemaObject;

  const result = { ...document };
  delete result.$schema;
  delete result.$id;

  return result;
}

/**
 * Expands an object schema into one OpenAPI parameter per property, so query
 * and path parameters show up individually in Swagger UI.
 */
export function toOpenApiParameters(schema: z.ZodType): OpenApiParameter[] {
  const document = toOpenApiSchema(schema);
  const properties = document.properties;

  if (
    document.type !== 'object' ||
    typeof properties !== 'object' ||
    properties === null
  ) {
    return [];
  }

  const required = new Set(
    Array.isArray(document.required) ? (document.required as string[]) : [],
  );

  return Object.entries(
    properties as Record<string, OpenApiSchemaObject>,
  ).map(([name, propertySchema]) => ({
    name,
    required: required.has(name),
    schema: propertySchema,
    description:
      typeof propertySchema.description === 'string'
        ? propertySchema.description
        : undefined,
  }));
}
