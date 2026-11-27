import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

export const WORKER_HEADER = 'x-notification-secret';

/**
 * Protects the outbox worker endpoint. Routes using it are `@Public()` so the
 * global JWT guard steps aside; the shared secret is the only credential. A
 * scheduled GitHub Actions workflow calls the endpoint to wake Render and to
 * drain due jobs.
 */
@Injectable()
export class NotificationWorkerGuard implements CanActivate {
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    this.secret =
      config.get('NOTIFICATION_WORKER_SECRET', { infer: true }) ??
      config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers[WORKER_HEADER];

    if (typeof header !== 'string' || !this.matches(header)) {
      throw new UnauthorizedException('Invalid worker credentials');
    }

    return true;
  }

  private matches(candidate: string): boolean {
    const expected = Buffer.from(this.secret);
    const received = Buffer.from(candidate);

    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }
}
