import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodBody } from '../common/zod/zod.decorators.js';
import { toOpenApiSchema } from '../common/zod/zod-openapi.js';
import {
  type AuthResult,
  authResultSchema,
  type ChangePasswordInput,
  changePasswordSchema,
  type LoginInput,
  loginSchema,
  type LogoutInput,
  logoutSchema,
  type MeResponse,
  meResponseSchema,
  type RefreshInput,
  refreshSchema,
  type RegisterInput,
  registerSchema,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';

const authResultOpenApi = toOpenApiSchema(authResultSchema) as SchemaObject;
const meOpenApi = toOpenApiSchema(meResponseSchema) as SchemaObject;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a business and its owner' })
  @ApiCreatedResponse({ schema: authResultOpenApi })
  register(@ZodBody(registerSchema) body: RegisterInput): Promise<AuthResult> {
    return this.auth.register(body);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ schema: authResultOpenApi })
  login(@ZodBody(loginSchema) body: LoginInput): Promise<AuthResult> {
    return this.auth.login(body);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  @ApiOkResponse({ schema: authResultOpenApi })
  refresh(@ZodBody(refreshSchema) body: RefreshInput): Promise<AuthResult> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session refresh token' })
  @ApiNoContentResponse()
  async logout(@ZodBody(logoutSchema) body: LogoutInput): Promise<void> {
    await this.auth.logout(body.refreshToken, body.allDevices);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change the current user password' })
  @ApiNoContentResponse()
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(changePasswordSchema) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(user.id, body);
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user and tenant memberships' })
  @ApiOkResponse({ schema: meOpenApi })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }
}
