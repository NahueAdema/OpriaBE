import {
  type ArgumentsHost,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

function createHost() {
  const send = vi.fn();
  const status = vi.fn().mockReturnThis();
  const type = vi.fn().mockReturnThis();
  const reply = {
    sent: false,
    status,
    type,
    send,
  } as unknown as FastifyReply;
  const request = {
    method: 'POST',
    url: '/v1/auth/login',
  } as FastifyRequest;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  return { host, reply, send, status, type };
}

describe('ProblemDetailsFilter', () => {
  it('propagates stable error codes in the problem response', () => {
    const config = {
      get: vi.fn(() => 'development'),
    } as unknown as ConfigService<Env, true>;
    const filter = new ProblemDetailsFilter(config);
    const { host, send, status, type } = createHost();

    filter.catch(
      new UnauthorizedException({
        message: 'Esta cuenta es de cliente.',
        code: 'CUSTOMER_ACCOUNT',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(type).toHaveBeenCalledWith('application/problem+json');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
        detail: 'Esta cuenta es de cliente.',
        code: 'CUSTOMER_ACCOUNT',
      }),
    );
  });

  it('omits code for generic exceptions', () => {
    const config = {
      get: vi.fn(() => 'development'),
    } as unknown as ConfigService<Env, true>;
    const filter = new ProblemDetailsFilter(config);
    const { host, send } = createHost();

    filter.catch(new UnauthorizedException('Invalid email or password'), host);

    expect(send).toHaveBeenCalledWith(
      expect.not.objectContaining({ code: expect.anything() }),
    );
  });
});
