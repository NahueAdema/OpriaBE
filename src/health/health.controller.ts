import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  type LivenessResponse,
  type ReadinessResponse,
  HealthService,
} from './health.service.js';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({
    description: 'The process is running and accepting traffic.',
  })
  liveness(): LivenessResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({
    description: 'The process can reach every dependency it needs.',
  })
  @ApiServiceUnavailableResponse({
    description: 'At least one dependency is not reachable.',
  })
  async readiness(): Promise<ReadinessResponse> {
    try {
      return await this.health.readiness();
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }
  }
}
