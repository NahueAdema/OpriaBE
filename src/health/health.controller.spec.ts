import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('maps a failed readiness check to 503', async () => {
    const health = {
      readiness: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as HealthService;
    const controller = new HealthController(health);

    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
