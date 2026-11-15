import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { output, ZodType } from 'zod';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Parses a value with a Zod schema and replaces it with the parsed output.
 *
 * Nest's built-in validation relies on class-validator; Opria uses Zod as the
 * only validation library so the same schema drives runtime validation, the
 * inferred TypeScript types and the OpenAPI document.
 */
export class ZodValidationPipe<TSchema extends ZodType>
  implements PipeTransform<unknown, output<TSchema>>
{
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): output<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors: ValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      }));

      throw new BadRequestException({
        message: 'Request validation failed',
        errors,
      });
    }

    return result.data;
  }
}
