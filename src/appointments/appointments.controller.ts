import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
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
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import {
  type AppointmentIdParams,
  appointmentIdParamsSchema,
  appointmentListResponseSchema,
  type AppointmentListResponse,
  appointmentResponseSchema,
  type AppointmentResponse,
  type CreatePanelAppointmentInput,
  createPanelAppointmentSchema,
  type IdempotencyHeaders,
  idempotencyHeadersSchema,
  type ListAppointmentsQuery,
  listAppointmentsQuerySchema,
  type RescheduleAppointmentInput,
  rescheduleAppointmentSchema,
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an appointment from the panel',
    description:
      'Validates the slot against the tenant availability and applies the same anti-double-booking guard as the public flow. Send a stable `Idempotency-Key` header: retrying the same key and payload returns the original appointment, reusing it with another payload answers 409.',
  })
  @ApiCreatedResponse({ schema: appointmentOpenApi })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Stable per-request key, at least 8 characters',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers() rawHeaders: Record<string, string | string[] | undefined>,
    @ZodBody(createPanelAppointmentSchema) body: CreatePanelAppointmentInput,
  ): Promise<AppointmentResponse> {
    // Nest's @Headers() has no parameter-pipe overload, so validate here with
    // the same Zod pipe used by @ZodBody/@ZodQuery/@ZodParam.
    const headers = new ZodValidationPipe(idempotencyHeadersSchema).transform(
      rawHeaders,
    ) as IdempotencyHeaders;

    return this.appointments.createPanel(
      user.tenantId,
      headers['idempotency-key'],
      body,
    );
  }

  @Patch(':id/reschedule')
  @ApiOperation({
    summary: 'Move an appointment to another time',
    description:
      'Respects the business `cancellationHours`: inside the notice window it answers 409. The slot is recomputed, the same professional is kept and both parties are notified.',
  })
  @ApiOkResponse({ schema: appointmentOpenApi })
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam(appointmentIdParamsSchema) params: AppointmentIdParams,
    @ZodBody(rescheduleAppointmentSchema) body: RescheduleAppointmentInput,
  ): Promise<AppointmentResponse> {
    return this.appointments.reschedule(user.tenantId, params.id, body);
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
