import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { WORKER_HEADER } from './notifications/notification-worker.guard.js';
import type { Env } from './config/env.js';

const DEV_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export async function createApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true },
  );

  app.useLogger(app.get(PinoLogger));
  app.flushLogs();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const swaggerEnabled =
    config.get('SWAGGER_ENABLED', { infer: true }) ?? nodeEnv !== 'production';

  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  const allowedOrigins =
    corsOrigins.length > 0
      ? corsOrigins
      : nodeEnv === 'development'
        ? DEV_CORS_ORIGINS
        : [];

  await app.register(helmet, {
    contentSecurityPolicy: swaggerEnabled ? false : undefined,
  });
  await app.register(cookie);
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../public', import.meta.url)),
    prefix: '/',
    wildcard: false,
  });

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }), {
    // The landing page lives at the root, outside the versioned API.
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Opria API')
        .setDescription(
          'Multi-tenant appointment scheduling API with AI-assisted booking.',
        )
        .setVersion('0.1.0')
        .addBearerAuth({
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        })
        .addApiKey(
          { type: 'apiKey', name: WORKER_HEADER, in: 'header' },
          'worker',
        )
        .build(),
    );

    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs/openapi.json',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  return app;
}
