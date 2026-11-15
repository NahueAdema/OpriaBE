import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { createApp } from './bootstrap.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  const port = config.get('PORT', { infer: true });
  const host = config.get('HOST', { infer: true });

  await app.listen({ port, host });

  app
    .get(PinoLogger)
    .log(`Opria API listening on http://${host}:${port}`, 'Bootstrap');
}

try {
  await bootstrap();
} catch (error) {
  console.error('Failed to start Opria API:', error);
  process.exit(1);
}
