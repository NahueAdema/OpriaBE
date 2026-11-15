import {
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from './jwt-auth.guard.js';

function createContext(request: Partial<AuthenticatedRequest>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const req = { headers: {}, ...request } as AuthenticatedRequest;

  return {
    request: req,
    context: {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

function createGuard(options: {
  isPublic?: boolean;
  verify?: (token: string) => Promise<unknown>;
}): { guard: JwtAuthGuard; verify: ReturnType<typeof vi.fn> } {
  const verify = vi.fn(options.verify ?? (async () => ({})));
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === IS_PUBLIC_KEY ? options.isPublic : undefined,
    ),
  } as unknown as Reflector;

  return {
    guard: new JwtAuthGuard({ verifyAsync: verify } as unknown as JwtService, reflector),
    verify,
  };
}

describe('JwtAuthGuard', () => {
  it('lets public routes through without a token', async () => {
    const { guard, verify } = createGuard({ isPublic: true });
    const { context } = createContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a request without an Authorization header', async () => {
    const { guard } = createGuard({});
    const { context } = createContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects non-Bearer schemes', async () => {
    const { guard } = createGuard({});
    const { context } = createContext({
      headers: { authorization: 'Basic abc' } as AuthenticatedRequest['headers'],
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps the token payload onto the request user', async () => {
    const { guard } = createGuard({
      verify: async () => ({
        sub: 'user-1',
        tid: 'tenant-1',
        role: 'admin',
        padmin: false,
      }),
    });
    const { context, request } = createContext({
      headers: {
        authorization: 'Bearer valid-token',
      } as AuthenticatedRequest['headers'],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
      isPlatformAdmin: false,
    });
  });

  it('accepts a lowercase bearer scheme', async () => {
    const { guard } = createGuard({
      verify: async () => ({
        sub: 'user-1',
        tid: 'tenant-1',
        role: 'owner',
        padmin: false,
      }),
    });
    const { context } = createContext({
      headers: {
        authorization: 'bearer valid-token',
      } as AuthenticatedRequest['headers'],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a token without the required claims', async () => {
    const { guard } = createGuard({ verify: async () => ({ sub: 'user-1' }) });
    const { context } = createContext({
      headers: {
        authorization: 'Bearer incomplete-token',
      } as AuthenticatedRequest['headers'],
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects invalid or expired tokens', async () => {
    const { guard } = createGuard({
      verify: async () => {
        throw new Error('jwt expired');
      },
    });
    const { context } = createContext({
      headers: {
        authorization: 'Bearer expired-token',
      } as AuthenticatedRequest['headers'],
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
