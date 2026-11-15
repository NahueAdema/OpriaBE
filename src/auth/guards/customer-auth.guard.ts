import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type {
  AuthenticatedCustomer,
  CustomerAccessTokenPayload,
} from '../auth.types.js';

export type CustomerAuthenticatedRequest = FastifyRequest & {
  customer?: AuthenticatedCustomer;
};

/**
 * Resolves the customer session for `/v1/customer/*` routes. Those routes are
 * marked `@Public()` so the global staff guard steps aside, and this guard is
 * applied with `@UseGuards`. It rejects staff tokens: the realms never mix.
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<CustomerAuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<
        Partial<CustomerAccessTokenPayload>
      >(token);

      if (!payload.sub || payload.typ !== 'customer') {
        throw new Error('Not a customer access token');
      }

      request.customer = { id: payload.sub };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
