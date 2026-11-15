import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentCustomer } from '../auth/decorators/current-customer.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard.js';
import type { AuthenticatedCustomer } from '../auth/auth.types.js';
import { ZodBody } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type CustomerAuthResult,
  customerAuthResultSchema,
  type CustomerLoginInput,
  customerLoginSchema,
  type CustomerLogoutInput,
  customerLogoutSchema,
  type CustomerMeResponse,
  customerMeSchema,
  type CustomerRefreshInput,
  customerRefreshSchema,
  type CustomerRegisterInput,
  customerRegisterSchema,
} from './customer-auth.schemas.js';
import { CustomerAuthService } from './customer-auth.service.js';

const authResultOpenApi = toOpenApiSchema(
  customerAuthResultSchema,
) as SchemaObject;
const meOpenApi = toOpenApiSchema(customerMeSchema) as SchemaObject;

@ApiTags('customer-auth')
@Controller('customer-auth')
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a customer account' })
  @ApiCreatedResponse({ schema: authResultOpenApi })
  register(
    @ZodBody(customerRegisterSchema) body: CustomerRegisterInput,
  ): Promise<CustomerAuthResult> {
    return this.auth.register(body);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign a customer in with email and password' })
  @ApiOkResponse({ schema: authResultOpenApi })
  login(
    @ZodBody(customerLoginSchema) body: CustomerLoginInput,
  ): Promise<CustomerAuthResult> {
    return this.auth.login(body);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a customer refresh token' })
  @ApiOkResponse({ schema: authResultOpenApi })
  refresh(
    @ZodBody(customerRefreshSchema) body: CustomerRefreshInput,
  ): Promise<CustomerAuthResult> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current customer session' })
  @ApiNoContentResponse()
  async logout(
    @ZodBody(customerLogoutSchema) body: CustomerLogoutInput,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken, body.allDevices);
  }

  @Public()
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Current customer account' })
  @ApiOkResponse({ schema: meOpenApi })
  me(@CurrentCustomer() customer: AuthenticatedCustomer): Promise<CustomerMeResponse> {
    return this.auth.me(customer.id);
  }
}
