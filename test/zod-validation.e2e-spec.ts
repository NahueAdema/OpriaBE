import { Controller, Module, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemDetailsFilter } from '../src/common/http/problem-details.filter.js';
import { ZodBody } from '../src/common/zod/zod.decorators.js';
import { validateEnv } from '../src/config/env.js';

const createUserSchema = z.object({
  email: z.email(),
  name: z.string().min(2),
});

type CreateUserInput = z.infer<typeof createUserSchema>;

@Controller('users')
class UsersController {
  @Post()
  create(@ZodBody(createUserSchema) body: CreateUserInput): CreateUserInput {
    return body;
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  controllers: [UsersController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
class ZodTestModule {}

describe('Zod validation (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ZodTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts and parses a valid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { email: 'ada@opria.app', name: 'Ada' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ email: 'ada@opria.app', name: 'Ada' });
  });

  it('rejects an invalid body as Problem Details', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { email: 'nope', name: 'A' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.json()).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Request validation failed',
      errors: [{ path: 'email' }, { path: 'name' }],
    });
  });
});
