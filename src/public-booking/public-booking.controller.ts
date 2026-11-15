import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  type CalendarQuery,
  calendarQuerySchema,
  type CalendarResponse,
  calendarResponseSchema,
} from '../availability/availability.schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type CreateAppointmentInput,
  createAppointmentInputSchema,
} from '../appointments/appointments.schemas.js';
import {
  type PublicAppointment,
  publicAppointmentSchema,
  type PublicAvailability,
  type PublicAvailabilityQuery,
  publicAvailabilityQuerySchema,
  publicAvailabilitySchema,
  type PublicBusiness,
  type PublicBusinessFilters,
  type PublicBusinessList,
  publicBusinessFiltersSchema,
  publicBusinessListSchema,
  publicBusinessSchema,
  type SearchBusinessesQuery,
  searchBusinessesQuerySchema,
  type SlugParams,
  slugParamsSchema,
} from './public-booking.schemas.js';
import { PublicBookingService } from './public-booking.service.js';

const businessListOpenApi = toOpenApiSchema(
  publicBusinessListSchema,
) as SchemaObject;
const businessFiltersOpenApi = toOpenApiSchema(
  publicBusinessFiltersSchema,
) as SchemaObject;
const businessOpenApi = toOpenApiSchema(publicBusinessSchema) as SchemaObject;
const availabilityOpenApi = toOpenApiSchema(
  publicAvailabilitySchema,
) as SchemaObject;
const calendarOpenApi = toOpenApiSchema(calendarResponseSchema) as SchemaObject;
const appointmentOpenApi = toOpenApiSchema(
  publicAppointmentSchema,
) as SchemaObject;

/**
 * Unauthenticated booking API used by the public page. Every route is rate
 * limited harder than the tenant API because it is reachable by anyone.
 */
@ApiTags('public-booking')
@Controller('public/businesses')
@Public()
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Search active businesses',
    description:
      'All filters are optional and combinable: `q` matches name or slug, `city` matches the business city and `service` matches an offered service name.',
  })
  @ApiOkResponse({ schema: businessListOpenApi })
  search(
    @ZodQuery(searchBusinessesQuerySchema) query: SearchBusinessesQuery,
  ): Promise<PublicBusinessList> {
    return this.booking.search(query);
  }

  // Declared before `:slug` so it is not captured as a business slug.
  @Get('filters')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Available cities and service names for filters' })
  @ApiOkResponse({ schema: businessFiltersOpenApi })
  getFilters(): Promise<PublicBusinessFilters> {
    return this.booking.getFilters();
  }

  @Get(':slug')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Public profile and bookable services' })
  @ApiOkResponse({ schema: businessOpenApi })
  getBusiness(
    @ZodParam(slugParamsSchema) params: SlugParams,
  ): Promise<PublicBusiness> {
    return this.booking.getBusiness(params.slug);
  }

  @Get(':slug/availability')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Free start times for a service on a date' })
  @ApiOkResponse({ schema: availabilityOpenApi })
  getAvailability(
    @ZodParam(slugParamsSchema) params: SlugParams,
    @ZodQuery(publicAvailabilityQuerySchema) query: PublicAvailabilityQuery,
  ): Promise<PublicAvailability> {
    return this.booking.getAvailability(params.slug, query);
  }

  @Get(':slug/calendar')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Which days of a range have free slots' })
  @ApiOkResponse({ schema: calendarOpenApi })
  getCalendar(
    @ZodParam(slugParamsSchema) params: SlugParams,
    @ZodQuery(calendarQuerySchema) query: CalendarQuery,
  ): Promise<CalendarResponse> {
    return this.booking.getCalendar(params.slug, query);
  }

  @Post(':slug/appointments')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request an appointment as a guest',
    description:
      'The appointment is created as `pending` and blocks the slot until the business confirms or rejects it.',
  })
  @ApiCreatedResponse({ schema: appointmentOpenApi })
  createAppointment(
    @ZodParam(slugParamsSchema) params: SlugParams,
    @ZodBody(createAppointmentInputSchema) body: CreateAppointmentInput,
  ): Promise<PublicAppointment> {
    return this.booking.createAppointment(params.slug, body);
  }
}
