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
import { ZodBody, ZodParam, ZodQuery } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type AppointmentIdParams,
  appointmentIdParamsSchema,
  appointmentListResponseSchema,
  type AppointmentListResponse,
  appointmentResponseSchema,
  type AppointmentResponse,
  type ListAppointmentsQuery,
  listAppointmentsQuerySchema,
  type UpdateAppointmentStatusInput,
  updateAppointmentStatusSchema,
} from './appointments.schemas.js';
import { AppointmentsService } from './appointments.service.js';

const listOpenApi = toOpenApiSchema(
  appointmentListResponseSchema,
) as SchemaObject;
const appointmentOpenApi = toOpenApiSchema(
  appointmentResponseSchema,
) as SchemaObject;

@ApiTags('appointments')
@Controller('appointments')
@Roles('owner', 'admin', 'staff')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List appointments for the agenda',
    description:
      'Filter by range, status, staff or service. `total` counts every match, so the panel can request `status=pending&limit=1` for the pending badge.',
  })
  @ApiOkResponse({ schema: listOpenApi })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(listAppointmentsQuerySchema) query: ListAppointmentsQuery,
  ): Promise<AppointmentListResponse> {
    return this.appointments.list(user.tenantId, query);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Confirm, reject, cancel or close an appointment',
  })
  @ApiOkResponse({ schema: appointmentOpenApi })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(appointmentIdParamsSchema) params: AppointmentIdParams,
    @ZodBody(updateAppointmentStatusSchema) body: UpdateAppointmentStatusInput,
  ): Promise<AppointmentResponse> {
    return this.appointments.updateStatus(user.tenantId, params.id, body);
  }
}
