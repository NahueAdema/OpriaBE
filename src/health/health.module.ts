import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { LandingController } from './landing.controller.js';

@Module({
  controllers: [HealthController, LandingController],
  providers: [HealthService],
})
export class HealthModule {}
