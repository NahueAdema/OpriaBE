import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { uniqueViolationConstraint } from '../common/database/postgres-errors.js';
import type { Env } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import {
  type Customer,
  customerRefreshTokens,
  customers,
} from '../database/schema/index.js';
import type {
  CustomerAuthResult,
  CustomerLoginInput,
  CustomerMeResponse,
  CustomerRegisterInput,
} from './customer-auth.schemas.js';
import type { CustomerAccessTokenPayload } from '../auth/auth.types.js';

const DAY_MS = 86_400_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(input: CustomerRegisterInput): Promise<CustomerAuthResult> {
    const passwordHash = await argon2.hash(input.password);

    try {
      const [customer] = await this.database.db
        .insert(customers)
        .values({
          email: input.email,
          name: input.name,
          phone: input.phone,
          passwordHash,
        })
        .returning();

      return this.buildAuthResult(customer);
    } catch (error) {
      if (uniqueViolationConstraint(error)?.includes('email')) {
        throw new ConflictException('Email is already registered');
      }

      throw error;
    }
  }

  async login(input: CustomerLoginInput): Promise<CustomerAuthResult> {
    const customer = await this.database.db.query.customers.findFirst({
      where: eq(customers.email, input.email),
    });

    if (!customer) {
      // Same timing as a real verification, so emails cannot be enumerated.
      await argon2.hash(input.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await argon2.verify(
      customer.passwordHash,
      input.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildAuthResult(customer);
  }

  async refresh(rawToken: string): Promise<CustomerAuthResult> {
    const stored = await this.database.db.query.customerRefreshTokens.findFirst(
      {
        where: eq(customerRefreshTokens.tokenHash, hashToken(rawToken)),
      },
    );

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Replay of a rotated token: assume theft and revoke the whole chain.
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token already used');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const customer = await this.database.db.query.customers.findFirst({
      where: eq(customers.id, stored.customerId),
    });

    if (!customer) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const nextRawToken = this.generateRefreshToken();

    const rotated = await this.database.db.transaction(async (tx) => {
      const revoked = await tx
        .update(customerRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(customerRefreshTokens.id, stored.id),
            isNull(customerRefreshTokens.revokedAt),
          ),
        )
        .returning({ id: customerRefreshTokens.id });

      if (revoked.length === 0) {
        return false;
      }

      await tx.insert(customerRefreshTokens).values({
        customerId: stored.customerId,
        familyId: stored.familyId,
        tokenHash: hashToken(nextRawToken),
        expiresAt: this.refreshExpiry(),
      });

      return true;
    });

    if (!rotated) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token already used');
    }

    return this.buildAuthResult(customer, nextRawToken);
  }

  async logout(rawToken: string, allDevices: boolean): Promise<void> {
    const stored = await this.database.db.query.customerRefreshTokens.findFirst(
      {
        where: eq(customerRefreshTokens.tokenHash, hashToken(rawToken)),
      },
    );

    if (!stored) {
      return;
    }

    if (allDevices) {
      await this.database.db
        .update(customerRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(customerRefreshTokens.customerId, stored.customerId),
            isNull(customerRefreshTokens.revokedAt),
          ),
        );
      return;
    }

    await this.revokeFamily(stored.familyId);
  }

  async me(customerId: string): Promise<CustomerMeResponse> {
    const customer = await this.database.db.query.customers.findFirst({
      where: eq(customers.id, customerId),
    });

    if (!customer) {
      throw new UnauthorizedException('Customer no longer exists');
    }

    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      emailVerifiedAt: customer.emailVerifiedAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
    };
  }

  private async buildAuthResult(
    customer: Customer,
    refreshToken?: string,
  ): Promise<CustomerAuthResult> {
    const payload: CustomerAccessTokenPayload = {
      sub: customer.id,
      typ: 'customer',
    };

    const accessToken = await this.jwt.signAsync(payload);
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });

    return {
      accessToken,
      refreshToken:
        refreshToken ??
        (await this.createRefreshToken(customer.id, randomUUID())),
      tokenType: 'Bearer',
      expiresIn,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
      },
    };
  }

  private async createRefreshToken(
    customerId: string,
    familyId: string,
  ): Promise<string> {
    const token = this.generateRefreshToken();

    await this.database.db.insert(customerRefreshTokens).values({
      customerId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt: this.refreshExpiry(),
    });

    return token;
  }

  private generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private refreshExpiry(): Date {
    const days = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * DAY_MS);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.database.db
      .update(customerRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(customerRefreshTokens.familyId, familyId),
          isNull(customerRefreshTokens.revokedAt),
        ),
      );
  }
}
