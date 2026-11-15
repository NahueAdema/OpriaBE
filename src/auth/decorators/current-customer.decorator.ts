import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedCustomer } from '../auth.types.js';

/** Injects the customer resolved by `CustomerAuthGuard`. */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedCustomer => {
    const request = context
      .switchToHttp()
      .getRequest<{ customer: AuthenticatedCustomer }>();

    return request.customer;
  },
);
