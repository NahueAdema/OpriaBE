import type { ConfigService } from '@nestjs/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { DatabaseService } from '../database/database.service.js';
import {
  AuthService,
  CUSTOMER_ACCOUNT_ERROR_CODE,
} from './auth.service.js';

vi.mock('argon2', () => ({
  default: {
    hash: vi.fn(),
    verify: vi.fn(),
  },
}));

const PASSWORD = 'super-secret-passphrase';

function makeUser() {
  return {
    id: 'user-1',
    email: 'owner@opria.test',
    passwordHash: 'user-hash',
    name: 'Test Owner',
    isPlatformAdmin: false,
    emailVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCustomer() {
  return {
    id: 'customer-1',
    email: 'cliente@opria.test',
    passwordHash: 'customer-hash',
    name: 'Test Customer',
    phone: '+54 9 11 5555 5555',
    emailVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeTenant(slug: string, status = 'active') {
  return {
    id: `tenant-${slug}`,
    name: slug,
    slug,
    status,
  };
}

function makeMembership(
  userId: string,
  tenant: ReturnType<typeof makeTenant>,
  role: 'owner' | 'admin' | 'staff' | 'customer',
) {
  return {
    id: `membership-${tenant.slug}`,
    userId,
    tenantId: tenant.id,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant,
  };
}

function createHarness(options: {
  user?: ReturnType<typeof makeUser> | null;
  customer?: ReturnType<typeof makeCustomer> | null;
  memberships?: ReturnType<typeof makeMembership>[];
}) {
  const usersFindFirst = vi
    .fn()
    .mockResolvedValue(options.user === undefined ? null : options.user);
  const customersFindFirst = vi
    .fn()
    .mockResolvedValue(options.customer === undefined ? null : options.customer);
  const membershipsFindMany = vi
    .fn()
    .mockResolvedValue(options.memberships ?? []);
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });

  const database = {
    db: {
      query: {
        users: { findFirst: usersFindFirst },
        customers: { findFirst: customersFindFirst },
        memberships: { findMany: membershipsFindMany },
      },
      insert,
    },
  } as unknown as DatabaseService;

  const jwt = {
    signAsync: vi.fn().mockResolvedValue('access-token'),
  } as unknown as JwtService;

  const config = {
    get: vi.fn((key: string) =>
      key === 'JWT_ACCESS_TTL_SECONDS' ? 900 : 30,
    ),
  } as unknown as ConfigService<Env, true>;

  return {
    service: new AuthService(database, jwt, config),
    customersFindFirst,
    membershipsFindMany,
    values,
  };
}

beforeEach(() => {
  vi.mocked(argon2.hash).mockReset().mockResolvedValue('dummy-hash');
  vi.mocked(argon2.verify).mockReset();
});

describe('AuthService.login', () => {
  it('signs in a single-tenant user without a slug', async () => {
    const user = makeUser();
    const tenant = makeTenant('demo');
    const harness = createHarness({
      user,
      memberships: [makeMembership(user.id, tenant, 'owner')],
    });
    vi.mocked(argon2.verify).mockImplementation(
      async (hash) => hash === 'user-hash',
    );

    const result = await harness.service.login({
      email: user.email,
      password: PASSWORD,
    });

    expect(harness.customersFindFirst).toHaveBeenCalled();
    expect(result.tenant).toMatchObject({ slug: 'demo', role: 'owner' });
  });

  it('picks the strongest active membership when no slug is provided', async () => {
    const user = makeUser();
    const harness = createHarness({
      user,
      memberships: [
        makeMembership(user.id, makeTenant('second'), 'staff'),
        makeMembership(user.id, makeTenant('first'), 'owner'),
        makeMembership(user.id, makeTenant('suspended', 'suspended'), 'owner'),
      ],
    });
    vi.mocked(argon2.verify).mockImplementation(
      async (hash) => hash === 'user-hash',
    );

    const result = await harness.service.login({
      email: user.email,
      password: PASSWORD,
    });

    expect(result.tenant).toMatchObject({ slug: 'first', role: 'owner' });
  });

  it('rejects a user without active memberships', async () => {
    const user = makeUser();
    const harness = createHarness({
      user,
      memberships: [makeMembership(user.id, makeTenant('demo', 'deleted'), 'owner')],
    });
    vi.mocked(argon2.verify).mockImplementation(
      async (hash) => hash === 'user-hash',
    );

    await expect(
      harness.service.login({ email: user.email, password: PASSWORD }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.values).not.toHaveBeenCalled();
  });

  it('points verified customer credentials at the customer portal', async () => {
    const customer = makeCustomer();
    const harness = createHarness({ customer });
    vi.mocked(argon2.verify).mockImplementation(
      async (hash) => hash === 'customer-hash',
    );

    await expect(
      harness.service.login({ email: customer.email, password: PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: CUSTOMER_ACCOUNT_ERROR_CODE }),
    });
    expect(harness.membershipsFindMany).not.toHaveBeenCalled();
  });

  it('points a user without memberships to the customer portal when both passwords match', async () => {
    const user = makeUser();
    const customer = { ...makeCustomer(), email: user.email };
    const harness = createHarness({ user, customer });
    vi.mocked(argon2.verify).mockResolvedValue(true);

    await expect(
      harness.service.login({ email: user.email, password: PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: CUSTOMER_ACCOUNT_ERROR_CODE }),
    });
    expect(harness.values).not.toHaveBeenCalled();
  });

  it('keeps the generic error when the staff password is wrong', async () => {
    const user = makeUser();
    const customer = makeCustomer();
    const harness = createHarness({ user, customer });
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(
      harness.service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'Invalid email or password' }),
    });
    expect(harness.membershipsFindMany).not.toHaveBeenCalled();
  });

  it('does not expose the customer hint without a valid password', async () => {
    const customer = makeCustomer();
    const harness = createHarness({ customer });
    vi.mocked(argon2.verify).mockResolvedValue(false);

    const error = await harness.service
      .login({ email: customer.email, password: 'wrong-password' })
      .catch((cause: unknown) => cause);
    const response = (error as UnauthorizedException).getResponse();

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(response).toMatchObject({ message: 'Invalid email or password' });
    expect(response).not.toHaveProperty('code');
    expect(harness.membershipsFindMany).not.toHaveBeenCalled();
  });

  it('rejects unknown emails with the generic error', async () => {
    const harness = createHarness({});
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(
      harness.service.login({
        email: 'unknown@opria.test',
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.membershipsFindMany).not.toHaveBeenCalled();
  });
});
