import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '../../database/schema/index.js';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given tenant roles.
 *
 * ```ts
 * @Roles('owner', 'admin')
 * @Get('settings')
 * settings() {}
 * ```
 */
export const Roles = (
  ...roles: MembershipRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
