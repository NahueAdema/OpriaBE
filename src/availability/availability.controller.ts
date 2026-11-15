import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ZodQuery } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type AvailabilityQuery,
  availabilityQuerySchema,
  type AvailabilityResponse,
  availabilityResponseSchema,
} from './availability.schemas.js';
import { AvailabilityService } from './availability.service.js';

const availabilityOpenApi = toOpenApiSchema(
  availabilityResponseSchema,
) as SchemaObject;

@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @ApiOperation({
    summary: 'Compute bookable start times for a service on a date',
  })
  @ApiOkResponse({ schema: availabilityOpenApi })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(availabilityQuerySchema) query: AvailabilityQuery,
  ): Promise<AvailabilityResponse> {
    return this.availability.get(user.tenantId, query);
  }
}
