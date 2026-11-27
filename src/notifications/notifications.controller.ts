import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { ZodBody } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import { NotificationWorkerGuard } from './notification-worker.guard.js';
import {
  type ProcessNotificationsInput,
  processNotificationsResponseSchema,
  processNotificationsSchema,
  type ProcessNotificationsResponse,
} from './notifications.schemas.js';
import { NotificationsService } from './notifications.service.js';

const responseOpenApi = toOpenApiSchema(
  processNotificationsResponseSchema,
) as SchemaObject;

/**
 * Worker endpoint. It is public only in the sense that it does not use a
 * tenant JWT; the shared-secret guard is its credential. The scheduled
 * workflow also wakes the Render service before it processes due jobs.
 */
@ApiTags('notifications')
@ApiSecurity('worker')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('process')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(NotificationWorkerGuard)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Process due notification jobs',
    description:
      'Claims a batch with `FOR UPDATE SKIP LOCKED` and sends it through the configured email provider. Intended for the scheduled GitHub Actions workflow.',
  })
  @ApiOkResponse({ schema: responseOpenApi })
  process(
    @ZodBody(processNotificationsSchema) body: ProcessNotificationsInput,
  ): Promise<ProcessNotificationsResponse> {
    return this.notifications.processBatch(body.limit);
  }
}
