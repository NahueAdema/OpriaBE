import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface LivenessResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'ok';
  checks: { database: 'up' };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  liveness(): LivenessResponse {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessResponse> {
    await this.database.ping();

    return {
      status: 'ok',
      checks: { database: 'up' },
      timestamp: new Date().toISOString(),
    };
  }
}
