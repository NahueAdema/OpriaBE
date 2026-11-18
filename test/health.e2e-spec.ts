import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';

describe('health (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('serves the landing page at /', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Opria');
    expect(response.body).toContain('/v1/health/ready');
    expect(response.body).toContain('/docs');
  });

  it('renders unknown routes as Problem Details', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.json()).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/v1/missing',
    });
  });
});
