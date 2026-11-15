import { Controller, Get, Patch } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ZodBody } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type BusinessResponse,
  businessResponseSchema,
  type UpdateBusinessInput,
  updateBusinessSchema,
} from './business.schemas.js';
import { BusinessService } from './business.service.js';

const businessOpenApi = toOpenApiSchema(
  businessResponseSchema,
) as SchemaObject;

@ApiTags('business')
@Controller('business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current tenant configuration' })
  @ApiOkResponse({ schema: businessOpenApi })
  get(@CurrentUser() user: AuthenticatedUser): Promise<BusinessResponse> {
    return this.business.get(user.tenantId);
  }

  @Roles('owner', 'admin')
  @Patch()
  @ApiOperation({ summary: 'Update the current tenant configuration' })
  @ApiOkResponse({ schema: businessOpenApi })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(updateBusinessSchema) body: UpdateBusinessInput,
  ): Promise<BusinessResponse> {
    return this.business.update(user.tenantId, body);
  }
}
