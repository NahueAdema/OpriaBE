import { Controller, Get, Post } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { ZodParam } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type ActionTokenParams,
  actionTokenParamsSchema,
  type PublicAppointmentActionResponse,
  publicAppointmentActionResponseSchema,
} from './public-appointment-actions.schemas.js';
import { PublicAppointmentActionsService } from './public-appointment-actions.service.js';

const responseOpenApi = toOpenApiSchema(
  publicAppointmentActionResponseSchema,
) as SchemaObject;

/**
 * One-click links from emails. GET makes the link usable straight from a mail
 * client; POST is provided for frontends that prefer an explicit action.
 */
@ApiTags('public-appointments')
@Controller('public/appointments')
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class PublicAppointmentActionsController {
  constructor(private readonly actions: PublicAppointmentActionsService) {}

  @Get(':token/confirm')
  @ApiOperation({ summary: 'Confirm an appointment from a signed email link' })
  @ApiOkResponse({ schema: responseOpenApi })
  confirmFromLink(
    @ZodParam(actionTokenParamsSchema) params: ActionTokenParams,
  ): Promise<PublicAppointmentActionResponse> {
    return this.actions.act(params.token, 'confirm');
  }

  @Post(':token/confirm')
  @ApiOperation({ summary: 'Confirm an appointment from a signed email link' })
  @ApiOkResponse({ schema: responseOpenApi })
  confirm(
    @ZodParam(actionTokenParamsSchema) params: ActionTokenParams,
  ): Promise<PublicAppointmentActionResponse> {
    return this.actions.act(params.token, 'confirm');
  }

  @Get(':token/cancel')
  @ApiOperation({ summary: 'Cancel an appointment from a signed email link' })
  @ApiOkResponse({ schema: responseOpenApi })
  cancelFromLink(
    @ZodParam(actionTokenParamsSchema) params: ActionTokenParams,
  ): Promise<PublicAppointmentActionResponse> {
    return this.actions.act(params.token, 'cancel');
  }

  @Post(':token/cancel')
  @ApiOperation({ summary: 'Cancel an appointment from a signed email link' })
  @ApiOkResponse({ schema: responseOpenApi })
  cancel(
    @ZodParam(actionTokenParamsSchema) params: ActionTokenParams,
  ): Promise<PublicAppointmentActionResponse> {
    return this.actions.act(params.token, 'cancel');
  }
}
