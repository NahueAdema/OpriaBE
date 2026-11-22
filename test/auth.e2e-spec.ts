import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUSTOMER_ACCOUNT_ERROR_CODE } from '../src/auth/auth.service.js';
import { createApp } from '../src/bootstrap.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  customers,
  memberships,
  tenants,
  users,
} from '../src/database/schema/index.js';

/**
 * These tests need a reachable Postgres with migrations applied:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://... npm run test:e2e
 */
const runDbTests = process.env.RUN_DB_TESTS === '1';

const suffix = `${Date.now()}`.slice(-8);
const email = `owner-${suffix}@opria.test`;
const customerEmail = `cliente-${suffix}@opria.test`;
const slug = `test-${suffix}`;
const password = 'super-secret-passphrase';

interface AuthResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; email: string; name: string };
  tenant: { id: string; name: string; slug: string; role: string };
}

describe.skipIf(!runDbTests)('auth (e2e)', () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let registered: AuthResult;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    if (!app) {
      return;
    }

    // Deleting the tenant and user cascades to memberships and refresh tokens.
    await database.db.delete(tenants).where(eq(tenants.slug, slug));
    await database.db.delete(users).where(eq(users.email, email));
    await database.db.delete(customers).where(eq(customers.email, customerEmail));
    await app.close();
  });

  it('rejects protected routes without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
  });

  it('registers a business and its owner', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        tenantName: 'Opria Test',
        tenantSlug: slug,
        name: 'Test Owner',
        email,
        password,
      },
    });

    expect(response.statusCode).toBe(201);

    registered = response.json<AuthResult>();

    expect(registered).toMatchObject({
      tokenType: 'Bearer',
      user: { email },
      tenant: { slug, role: 'owner' },
    });
    expect(registered.accessToken.split('.')).toHaveLength(3);
    expect(registered.refreshToken.length).toBeGreaterThan(20);
  });

  it('returns the current user and memberships', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${registered.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      email,
      memberships: [{ tenant: { slug }, role: 'owner' }],
    });
  });

  it('rejects a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'not-the-password' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('logs in and rotates refresh tokens', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });

    expect(login.statusCode).toBe(200);
    const first = login.json<AuthResult>();

    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });

    expect(rotated.statusCode).toBe(200);
    const second = rotated.json<AuthResult>();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const rotatedAgain = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: second.refreshToken },
    });
    expect(rotatedAgain.statusCode).toBe(200);

    // Replaying an already rotated token revokes the whole family.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(replay.statusCode).toBe(401);

    const afterReuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: rotatedAgain.json<AuthResult>().refreshToken },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: registered.refreshToken },
    });

    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: registered.refreshToken },
    });

    expect(refresh.statusCode).toBe(401);
  });

  it('picks the highest-priority tenant when the user belongs to several', async () => {
    const secondSlug = `${slug}-two`;

    const [secondTenant] = await database.db
      .insert(tenants)
      .values({ name: 'Opria Test Two', slug: secondSlug })
      .returning();

    await database.db.insert(memberships).values({
      tenantId: secondTenant.id,
      userId: registered.user.id,
      role: 'staff',
    });

    const withoutSlug = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    expect(withoutSlug.statusCode).toBe(200);
    expect(withoutSlug.json<AuthResult>().tenant).toMatchObject({
      slug,
      role: 'owner',
    });

    const withSlug = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password, tenantSlug: secondSlug },
    });
    expect(withSlug.statusCode).toBe(200);
    expect(withSlug.json<AuthResult>().tenant).toMatchObject({
      slug: secondSlug,
      role: 'staff',
    });

    await database.db.delete(tenants).where(eq(tenants.slug, secondSlug));
  });

  it('returns a stable hint when customer credentials hit the business login', async () => {
    const customerPassword = 'cliente-super-secreto';

    const registration = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/register',
      payload: {
        name: 'Cliente Test',
        email: customerEmail,
        phone: '+54 9 11 5555 5555',
        password: customerPassword,
      },
    });
    expect(registration.statusCode).toBe(201);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: customerEmail, password: customerPassword },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ code?: string }>().code).toBe(
      CUSTOMER_ACCOUNT_ERROR_CODE,
    );
  });

  it('rejects a wrong current password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${registered.accessToken}` },
      payload: {
        currentPassword: 'not-the-password',
        newPassword: 'brand-new-passphrase',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects reusing the current password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${registered.accessToken}` },
      payload: { currentPassword: password, newPassword: password },
    });

    expect(response.statusCode).toBe(400);
  });

  it('changes the password and revokes the other sessions', async () => {
    const nextPassword = 'even-more-secret-passphrase';

    const firstSession = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    const first = firstSession.json<AuthResult>();
    expect(firstSession.statusCode).toBe(200);

    const secondSession = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    const second = secondSession.json<AuthResult>();
    expect(secondSession.statusCode).toBe(200);

    const changed = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${first.accessToken}` },
      payload: {
        currentPassword: password,
        newPassword: nextPassword,
        refreshToken: first.refreshToken,
      },
    });

    expect(changed.statusCode).toBe(204);

    // The session that changed the password survives the rotation...
    const kept = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(kept.statusCode).toBe(200);

    // ...while every other device must sign in again.
    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: second.refreshToken },
    });
    expect(revoked.statusCode).toBe(401);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: nextPassword },
    });
    expect(newLogin.statusCode).toBe(200);

    const session = newLogin.json<AuthResult>();

    // Restore the original password for the remaining tests.
    const reverted = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        currentPassword: nextPassword,
        newPassword: password,
        refreshToken: session.refreshToken,
      },
    });
    expect(reverted.statusCode).toBe(204);
  });

  it('rejects duplicate registrations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        tenantName: 'Opria Test',
        tenantSlug: slug,
        name: 'Test Owner',
        email,
        password,
      },
    });

    expect(response.statusCode).toBe(409);
  });
});
