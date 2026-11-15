import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  ZodBody,
  ZodParam,
  ZodQuery,
} from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type CreateServiceInput,
  createServiceSchema,
  type ListServicesQuery,
  listServicesQuerySchema,
  type ServiceResponse,
  serviceResponseSchema,
  type UpdateServiceInput,
  updateServiceSchema,
} from './services.schemas.js';
import { ServicesService } from './services.service.js';

const idParamsSchema = z.object({ id: z.uuid() });
const serviceOpenApi = toOpenApiSchema(serviceResponseSchema) as SchemaObject;
const serviceListOpenApi = toOpenApiSchema(
  z.array(serviceResponseSchema),
) as SchemaObject;

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @ApiOperation({ summary: 'List the tenant services' })
  @ApiOkResponse({ schema: serviceListOpenApi })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(listServicesQuerySchema) query: ListServicesQuery,
  ): Promise<ServiceResponse[]> {
    return this.services.list(user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service' })
  @ApiOkResponse({ schema: serviceOpenApi })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: z.infer<typeof idParamsSchema>,
  ): Promise<ServiceResponse> {
    return this.services.get(user.tenantId, params.id);
  }

  @Roles('owner', 'admin')
  @Post()
  @ApiOperation({ summary: 'Create a service' })
  @ApiCreatedResponse({ schema: serviceOpenApi })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createServiceSchema) body: CreateServiceInput,
  ): Promise<ServiceResponse> {
    return this.services.create(user.tenantId, body);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a service' })
  @ApiOkResponse({ schema: serviceOpenApi })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: z.infer<typeof idParamsSchema>,
    @ZodBody(updateServiceSchema) body: UpdateServiceInput,
  ): Promise<ServiceResponse> {
    return this.services.update(user.tenantId, params.id, body);
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a service (soft delete)' })
  @ApiNoContentResponse()
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: z.infer<typeof idParamsSchema>,
  ): Promise<void> {
    await this.services.deactivate(user.tenantId, params.id);
  }
}
