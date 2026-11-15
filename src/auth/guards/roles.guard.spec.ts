import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

function createGuard(
  roles: string[] | undefined,
  user?: AuthenticatedUser,
): { guard: RolesGuard; context: ExecutionContext } {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === ROLES_KEY ? roles : undefined,
    ),
  } as unknown as Reflector;

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;

  return { guard: new RolesGuard(reflector), context };
}

describe('RolesGuard', () => {
  it('allows routes without @Roles metadata', () => {
    const { guard, context } = createGuard(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('requires an authenticated user', () => {
    const { guard, context } = createGuard(['owner']);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('allows a matching role', () => {
    const { guard, context } = createGuard(['owner', 'admin'], {
      id: 'u1',
      tenantId: 't1',
      role: 'admin',
      isPlatformAdmin: false,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a non-matching role', () => {
    const { guard, context } = createGuard(['owner'], {
      id: 'u1',
      tenantId: 't1',
      role: 'staff',
      isPlatformAdmin: false,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('lets platform admins bypass tenant role checks', () => {
    const { guard, context } = createGuard(['owner'], {
      id: 'u1',
      tenantId: 't1',
      role: 'customer',
      isPlatformAdmin: true,
    });

    expect(guard.canActivate(context)).toBe(true);
  });
});
