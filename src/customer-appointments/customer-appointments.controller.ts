import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedCustomer } from '../auth/auth.types.js';
import { CurrentCustomer } from '../auth/decorators/current-customer.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard.js';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type CreateCustomerAppointmentInput,
  createCustomerAppointmentSchema,
  type CustomerAppointment,
  type CustomerAppointmentIdParams,
  customerAppointmentIdParamsSchema,
  type CustomerAppointmentList,
  customerAppointmentListSchema,
  customerAppointmentSchema,
  type ListCustomerAppointmentsQuery,
  listCustomerAppointmentsQuerySchema,
} from './customer-appointments.schemas.js';
import { CustomerAppointmentsService } from './customer-appointments.service.js';

const appointmentOpenApi = toOpenApiSchema(
  customerAppointmentSchema,
) as SchemaObject;
const listOpenApi = toOpenApiSchema(customerAppointmentListSchema) as SchemaObject;

/**
 * Customer-facing appointment API. `@Public()` disables the staff guard; the
 * customer guard applied here rejects staff tokens.
 */
@ApiTags('customer-appointments')
@ApiBearerAuth()
@Controller('customer/appointments')
@Public()
@UseGuards(CustomerAuthGuard)
export class CustomerAppointmentsController {
  constructor(private readonly appointments: CustomerAppointmentsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List the signed-in customer appointments' })
  @ApiOkResponse({ schema: listOpenApi })
  list(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @ZodQuery(listCustomerAppointmentsQuerySchema)
    query: ListCustomerAppointmentsQuery,
  ): Promise<CustomerAppointmentList> {
    return this.appointments.list(customer.id, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Book an appointment as the signed-in customer',
    description:
      'Name, phone and email come from the account. The slot is recomputed against availability and the appointment starts as `pending`.',
  })
  @ApiCreatedResponse({ schema: appointmentOpenApi })
  create(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @ZodBody(createCustomerAppointmentSchema) body: CreateCustomerAppointmentInput,
  ): Promise<CustomerAppointment> {
    return this.appointments.create(customer.id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cancel an appointment',
    description:
      'Respects the business `cancellationHours`: inside the window the request fails with 409.',
  })
  @ApiOkResponse({ schema: appointmentOpenApi })
  cancel(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @ZodParam(customerAppointmentIdParamsSchema)
    params: CustomerAppointmentIdParams,
  ): Promise<CustomerAppointment> {
    return this.appointments.cancel(customer.id, params.id);
  }
}
