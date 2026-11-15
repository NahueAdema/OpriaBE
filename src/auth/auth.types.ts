import type { MembershipRole } from '../database/schema/index.js';

/** What the staff access token carries and what guards attach to the request. */
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** Active tenant id. */
  tid: string;
  role: MembershipRole;
  /** Platform administrator flag. */
  padmin: boolean;
}

/**
 * Customer tokens share the signing secret with staff tokens, so the `typ`
 * claim is what keeps the two realms apart. Staff tokens do not carry it.
 */
export interface CustomerAccessTokenPayload {
  /** Customer id. */
  sub: string;
  typ: 'customer';
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  role: MembershipRole;
  isPlatformAdmin: boolean;
}

export interface AuthenticatedCustomer {
  id: string;
}
