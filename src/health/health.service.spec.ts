import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { HealthService } from './health.service.js';

function createService(ping: () => Promise<void>): HealthService {
  return new HealthService({ ping } as unknown as DatabaseService);
}

describe('HealthService', () => {
  it('reports liveness without touching the database', () => {
    const ping = vi.fn();
    const service = createService(ping);

    expect(service.liveness()).toMatchObject({ status: 'ok' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports readiness when the database responds', async () => {
    const service = createService(vi.fn().mockResolvedValue(undefined));

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('propagates database failures', async () => {
    const service = createService(
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );

    await expect(service.readiness()).rejects.toThrow('connection refused');
  });
});
