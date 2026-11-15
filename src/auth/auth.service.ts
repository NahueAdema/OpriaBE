import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { uniqueViolationConstraint } from '../common/database/postgres-errors.js';
import type { Env } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import {
  type Membership,
  memberships,
  refreshTokens,
  type Tenant,
  tenants,
  type User,
  users,
} from '../database/schema/index.js';
import {
  type AuthResult,
  type ChangePasswordInput,
  type LoginInput,
  type MeResponse,
  type RegisterInput,
} from './auth.schemas.js';
import type { AccessTokenPayload } from './auth.types.js';

const DAY_MS = 86_400_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await argon2.hash(input.password);

    try {
      const { user, membership, tenant } = await this.database.db.transaction(
        async (tx) => {
          const [tenant] = await tx
            .insert(tenants)
            .values({
              name: input.tenantName,
              slug: input.tenantSlug,
            })
            .returning();

          const [user] = await tx
            .insert(users)
            .values({
              email: input.email,
              name: input.name,
              passwordHash,
            })
            .returning();

          const [membership] = await tx
            .insert(memberships)
            .values({
              tenantId: tenant.id,
              userId: user.id,
              role: 'owner',
            })
            .returning();

          return { user, membership, tenant };
        },
      );

      return this.buildAuthResult(user, membership, tenant);
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);

      if (constraint?.includes('slug')) {
        throw new ConflictException('Tenant slug is already taken');
      }

      if (constraint?.includes('email')) {
        throw new ConflictException('Email is already registered');
      }

      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.database.db.query.users.findFirst({
      where: eq(users.email, input.email),
    });

    if (!user) {
      // Spend the same time as a real verification to avoid leaking which
      // emails are registered.
      await argon2.hash(input.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await argon2.verify(
      user.passwordHash,
      input.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const candidates = await this.database.db.query.memberships.findMany({
      where: eq(memberships.userId, user.id),
      with: { tenant: true },
    });

    if (candidates.length === 0) {
      throw new ForbiddenException('User does not belong to any tenant');
    }

    const membership = this.pickMembership(candidates, input.tenantSlug);

    if (membership.tenant.status !== 'active') {
      throw new ForbiddenException('Tenant is not active');
    }

    return this.buildAuthResult(user, membership, membership.tenant);
  }

  async refresh(rawToken: string): Promise<AuthResult> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.database.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // A revoked token was replayed: assume theft and revoke the whole chain.
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token already used');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const [user, membership] = await Promise.all([
      this.database.db.query.users.findFirst({
        where: eq(users.id, stored.userId),
      }),
      this.database.db.query.memberships.findFirst({
        where: and(
          eq(memberships.userId, stored.userId),
          eq(memberships.tenantId, stored.tenantId),
        ),
        with: { tenant: true },
      }),
    ]);

    if (!user || !membership || membership.tenant.status !== 'active') {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const nextRawToken = this.generateRefreshToken();
    const nextExpiresAt = this.refreshExpiry();

    const rotated = await this.database.db.transaction(async (tx) => {
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(refreshTokens.id, stored.id), isNull(refreshTokens.revokedAt)),
        )
        .returning({ id: refreshTokens.id });

      if (revoked.length === 0) {
        return false;
      }

      await tx.insert(refreshTokens).values({
        userId: stored.userId,
        tenantId: stored.tenantId,
        familyId: stored.familyId,
        tokenHash: hashToken(nextRawToken),
        expiresAt: nextExpiresAt,
      });

      return true;
    });

    if (!rotated) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token already used');
    }

    return this.buildAuthResult(
      user,
      membership,
      membership.tenant,
      nextRawToken,
    );
  }

  async logout(rawToken: string, allDevices: boolean): Promise<void> {
    const stored = await this.database.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, hashToken(rawToken)),
    });

    if (!stored) {
      return;
    }

    if (allDevices) {
      await this.database.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, stored.userId),
            isNull(refreshTokens.revokedAt),
          ),
        );
      return;
    }

    await this.revokeFamily(stored.familyId);
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<void> {
    const user = await this.database.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const passwordMatches = await argon2.verify(
      user.passwordHash,
      input.currentPassword,
    );

    if (!passwordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await argon2.hash(input.newPassword);

    // Keep the session that proved ownership of its refresh token; every
    // other device must sign in again with the new password.
    let keepFamilyId: string | null = null;

    if (input.refreshToken) {
      const stored = await this.database.db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, hashToken(input.refreshToken)),
      });

      if (stored && stored.userId === user.id && !stored.revokedAt) {
        keepFamilyId = stored.familyId;
      }
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, user.id),
            isNull(refreshTokens.revokedAt),
            keepFamilyId ? ne(refreshTokens.familyId, keepFamilyId) : undefined,
          ),
        );
    });
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.database.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const rows = await this.database.db.query.memberships.findMany({
      where: eq(memberships.userId, user.id),
      with: { tenant: true },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      memberships: rows.map((row) => ({
        tenant: {
          id: row.tenant.id,
          name: row.tenant.name,
          slug: row.tenant.slug,
          status: row.tenant.status,
        },
        role: row.role,
      })),
    };
  }

  private pickMembership(
    candidates: Array<Membership & { tenant: Tenant }>,
    tenantSlug?: string,
  ): Membership & { tenant: Tenant } {
    if (tenantSlug) {
      const membership = candidates.find(
        (candidate) => candidate.tenant.slug === tenantSlug,
      );

      if (!membership) {
        throw new ForbiddenException('User is not a member of this tenant');
      }

      return membership;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    throw new BadRequestException(
      'tenantSlug is required when the user belongs to multiple tenants',
    );
  }

  private async buildAuthResult(
    user: User,
    membership: Membership,
    tenant: Tenant,
    refreshToken?: string,
  ): Promise<AuthResult> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      tid: membership.tenantId,
      role: membership.role,
      padmin: user.isPlatformAdmin,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });

    return {
      accessToken,
      refreshToken:
        refreshToken ??
        (await this.createRefreshToken(user.id, tenant.id, randomUUID())),
      tokenType: 'Bearer',
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        role: membership.role,
      },
    };
  }

  private async createRefreshToken(
    userId: string,
    tenantId: string,
    familyId: string,
  ): Promise<string> {
    const token = this.generateRefreshToken();

    await this.database.db.insert(refreshTokens).values({
      userId,
      tenantId,
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
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }
}
