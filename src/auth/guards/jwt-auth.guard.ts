import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type { AccessTokenPayload, AuthenticatedUser } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

export type AuthenticatedRequest = FastifyRequest & {
  user?: AuthenticatedUser;
};

/**
 * Global guard: every route requires a valid Bearer access token unless it is
 * marked with `@Public()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    // RFC 7235: the auth scheme is case-insensitive.
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<
        Partial<AccessTokenPayload> & { typ?: string }
      >(token);

      // Customer tokens are signed with the same secret but belong to a
      // different realm: they can never authorize a staff route.
      if (payload.typ === 'customer') {
        throw new Error('Customer token cannot access staff routes');
      }

      if (!payload.sub || !payload.tid || !payload.role) {
        throw new Error('Malformed access token payload');
      }

      request.user = {
        id: payload.sub,
        tenantId: payload.tid,
        role: payload.role,
        isPlatformAdmin: payload.padmin === true,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
