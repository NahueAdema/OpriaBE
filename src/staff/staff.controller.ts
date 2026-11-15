import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
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
  type CreateStaffInput,
  createStaffSchema,
  type CreateTimeBlockInput,
  createTimeBlockSchema,
  type ListStaffQuery,
  listStaffQuerySchema,
  type ListTimeBlocksQuery,
  listTimeBlocksQuerySchema,
  type ReplaceWorkingHoursInput,
  replaceWorkingHoursSchema,
  type SetStaffServicesInput,
  setStaffServicesSchema,
  type StaffResponse,
  staffResponseSchema,
  staffServicesResponseSchema,
  type TimeBlockResponse,
  timeBlockResponseSchema,
  type UpdateStaffInput,
  updateStaffSchema,
  type WorkingHoursResponse,
  workingHoursResponseSchema,
} from './staff.schemas.js';
import { StaffService } from './staff.service.js';

const idParamsSchema = z.object({ id: z.uuid() });
const blockParamsSchema = z.object({
  id: z.uuid(),
  blockId: z.uuid(),
});

type IdParams = z.infer<typeof idParamsSchema>;
type BlockParams = z.infer<typeof blockParamsSchema>;

const staffOpenApi = toOpenApiSchema(staffResponseSchema) as SchemaObject;
const staffListOpenApi = toOpenApiSchema(
  z.array(staffResponseSchema),
) as SchemaObject;
const staffServicesOpenApi = toOpenApiSchema(
  staffServicesResponseSchema,
) as SchemaObject;
const workingHoursOpenApi = toOpenApiSchema(
  workingHoursResponseSchema,
) as SchemaObject;
const timeBlockOpenApi = toOpenApiSchema(
  timeBlockResponseSchema,
) as SchemaObject;
const timeBlockListOpenApi = toOpenApiSchema(
  z.array(timeBlockResponseSchema),
) as SchemaObject;

@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'List the tenant staff' })
  @ApiOkResponse({ schema: staffListOpenApi })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(listStaffQuerySchema) query: ListStaffQuery,
  ): Promise<StaffResponse[]> {
    return this.staff.list(user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a staff member' })
  @ApiOkResponse({ schema: staffOpenApi })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
  ): Promise<StaffResponse> {
    return this.staff.get(user.tenantId, params.id);
  }

  @Roles('owner', 'admin')
  @Post()
  @ApiOperation({ summary: 'Create a staff member' })
  @ApiCreatedResponse({ schema: staffOpenApi })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createStaffSchema) body: CreateStaffInput,
  ): Promise<StaffResponse> {
    return this.staff.create(user.tenantId, body);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a staff member' })
  @ApiOkResponse({ schema: staffOpenApi })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
    @ZodBody(updateStaffSchema) body: UpdateStaffInput,
  ): Promise<StaffResponse> {
    return this.staff.update(user.tenantId, params.id, body);
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a staff member (soft delete)' })
  @ApiNoContentResponse()
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
  ): Promise<void> {
    await this.staff.deactivate(user.tenantId, params.id);
  }

  @Get(':id/services')
  @ApiOperation({ summary: 'List the services a staff member performs' })
  @ApiOkResponse({ schema: staffServicesOpenApi })
  async getServices(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
  ): Promise<{ services: StaffResponse['services'] }> {
    const member = await this.staff.get(user.tenantId, params.id);

    return { services: member.services };
  }

  @Roles('owner', 'admin')
  @Put(':id/services')
  @ApiOperation({ summary: 'Replace the services a staff member performs' })
  @ApiOkResponse({ schema: staffOpenApi })
  setServices(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
    @ZodBody(setStaffServicesSchema) body: SetStaffServicesInput,
  ): Promise<StaffResponse> {
    return this.staff.setServices(user.tenantId, params.id, body);
  }

  @Get(':id/working-hours')
  @ApiOperation({ summary: 'Get the weekly schedule of a staff member' })
  @ApiOkResponse({ schema: workingHoursOpenApi })
  getWorkingHours(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
  ): Promise<WorkingHoursResponse> {
    return this.staff.getWorkingHours(user.tenantId, params.id);
  }

  @Roles('owner', 'admin')
  @Put(':id/working-hours')
  @ApiOperation({ summary: 'Replace the weekly schedule of a staff member' })
  @ApiOkResponse({ schema: workingHoursOpenApi })
  replaceWorkingHours(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
    @ZodBody(replaceWorkingHoursSchema) body: ReplaceWorkingHoursInput,
  ): Promise<WorkingHoursResponse> {
    return this.staff.replaceWorkingHours(user.tenantId, params.id, body);
  }

  @Get(':id/time-blocks')
  @ApiOperation({ summary: 'List time blocks of a staff member' })
  @ApiOkResponse({ schema: timeBlockListOpenApi })
  listTimeBlocks(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
    @ZodQuery(listTimeBlocksQuerySchema) query: ListTimeBlocksQuery,
  ): Promise<TimeBlockResponse[]> {
    return this.staff.listTimeBlocks(user.tenantId, params.id, query);
  }

  @Roles('owner', 'admin')
  @Post(':id/time-blocks')
  @ApiOperation({ summary: 'Create a time block for a staff member' })
  @ApiCreatedResponse({ schema: timeBlockOpenApi })
  createTimeBlock(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(idParamsSchema) params: IdParams,
    @ZodBody(createTimeBlockSchema) body: CreateTimeBlockInput,
  ): Promise<TimeBlockResponse> {
    return this.staff.createTimeBlock(user.tenantId, params.id, body);
  }

  @Roles('owner', 'admin')
  @Delete(':id/time-blocks/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a time block' })
  @ApiNoContentResponse()
  async deleteTimeBlock(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(blockParamsSchema) params: BlockParams,
  ): Promise<void> {
    await this.staff.deleteTimeBlock(
      user.tenantId,
      params.id,
      params.blockId,
    );
  }
}
