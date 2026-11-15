import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
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
const password = 'super-secret-passphrase';
const slugA = `biz-a-${suffix}`;
const slugB = `biz-b-${suffix}`;
const emailA = `owner-a-${suffix}@opria.test`;
const emailB = `owner-b-${suffix}@opria.test`;

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
  tenant: { id: string; slug: string; role: string };
}

interface ServiceBody {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
  depositType: string;
  depositValue: number;
  active: boolean;
}

interface StaffBody {
  id: string;
  name: string;
  active: boolean;
  services: Array<{ id: string; name: string; active: boolean }>;
}

interface TimeBlockBody {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

describe.skipIf(!runDbTests)('business configuration (e2e)', () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let ownerA: AuthResult;
  let ownerB: AuthResult;
  let serviceId: string;
  let staffId: string;
  let timeBlockId: string;

  function headers(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  async function register(
    slug: string,
    email: string,
    tenantName: string,
  ): Promise<AuthResult> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        tenantName,
        tenantSlug: slug,
        name: 'Business Owner',
        email,
        password,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<AuthResult>();
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    database = app.get(DatabaseService);

    ownerA = await register(slugA, emailA, 'Business A');
    ownerB = await register(slugB, emailB, 'Business B');
  });

  afterAll(async () => {
    if (!app) {
      return;
    }

    // Cascades to services, staff, working hours and time blocks.
    await database.db.delete(tenants).where(eq(tenants.slug, slugA));
    await database.db.delete(tenants).where(eq(tenants.slug, slugB));
    await database.db.delete(users).where(eq(users.email, emailA));
    await database.db.delete(users).where(eq(users.email, emailB));
    await app.close();
  });

  describe('tenant configuration', () => {
    it('returns the defaults of a newly registered tenant', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/business',
        headers: headers(ownerA.accessToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'Business A',
        slug: slugA,
        timezone: 'America/Argentina/Buenos_Aires',
        plan: 'free',
        status: 'active',
        cancellationHours: 24,
        cancellationDepositPolicy: 'retain',
        bookingMinAdvanceMinutes: 0,
        bookingMaxAdvanceDays: 90,
        logoUrl: null,
        address: null,
        contactEmail: null,
        contactPhone: null,
      });
    });

    it('updates the profile and booking policies', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/business',
        headers: headers(ownerA.accessToken),
        payload: {
          name: 'Business A Studio',
          timezone: 'America/Argentina/Cordoba',
          address: 'Av. Siempreviva 742',
          contactEmail: 'Hello@BusinessA.test',
          contactPhone: '+54 11 5555-1234',
          cancellationHours: 12,
          cancellationDepositPolicy: 'refund',
          bookingMinAdvanceMinutes: 60,
          bookingMaxAdvanceDays: 30,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'Business A Studio',
        timezone: 'America/Argentina/Cordoba',
        address: 'Av. Siempreviva 742',
        // Emails are normalized to lowercase.
        contactEmail: 'hello@businessa.test',
        contactPhone: '+54 11 5555-1234',
        cancellationHours: 12,
        cancellationDepositPolicy: 'refund',
        bookingMinAdvanceMinutes: 60,
        bookingMaxAdvanceDays: 30,
      });
    });

    it('rejects reserved slugs, invalid timezones and empty payloads', async () => {
      const reserved = await app.inject({
        method: 'PATCH',
        url: '/v1/business',
        headers: headers(ownerA.accessToken),
        payload: { slug: 'docs' },
      });
      expect(reserved.statusCode).toBe(400);
      expect(reserved.headers['content-type']).toContain(
        'application/problem+json',
      );

      const timezone = await app.inject({
        method: 'PATCH',
        url: '/v1/business',
        headers: headers(ownerA.accessToken),
        payload: { timezone: 'Mars/Olympus_Mons' },
      });
      expect(timezone.statusCode).toBe(400);

      const empty = await app.inject({
        method: 'PATCH',
        url: '/v1/business',
        headers: headers(ownerA.accessToken),
        payload: {},
      });
      expect(empty.statusCode).toBe(400);
    });

    it('rejects a slug already used by another tenant', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/business',
        headers: headers(ownerA.accessToken),
        payload: { slug: slugB },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('services', () => {
    it('creates a service with a fixed deposit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/services',
        headers: headers(ownerA.accessToken),
        payload: {
          name: 'Haircut',
          description: 'Wash, cut and dry',
          durationMinutes: 45,
          priceCents: 10_000,
          depositType: 'fixed',
          depositValue: 2_000,
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json<ServiceBody>();
      serviceId = body.id;

      expect(body).toMatchObject({
        name: 'Haircut',
        durationMinutes: 45,
        priceCents: 10_000,
        depositType: 'fixed',
        depositValue: 2_000,
        active: true,
      });
    });

    it('rejects an invalid deposit combination', async () => {
      const fixedAbovePrice = await app.inject({
        method: 'POST',
        url: '/v1/services',
        headers: headers(ownerA.accessToken),
        payload: {
          name: 'Bad deposit',
          durationMinutes: 30,
          priceCents: 1_000,
          depositType: 'fixed',
          depositValue: 2_000,
        },
      });

      expect(fixedAbovePrice.statusCode).toBe(400);
      expect(fixedAbovePrice.json().errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'depositValue' }),
        ]),
      );

      const percentageAboveHundred = await app.inject({
        method: 'POST',
        url: '/v1/services',
        headers: headers(ownerA.accessToken),
        payload: {
          name: 'Bad percentage',
          durationMinutes: 30,
          depositType: 'percentage',
          depositValue: 150,
        },
      });

      expect(percentageAboveHundred.statusCode).toBe(400);
    });

    it('lists and reads the tenant services', async () => {
      const list = await app.inject({
        method: 'GET',
        url: '/v1/services',
        headers: headers(ownerA.accessToken),
      });

      expect(list.statusCode).toBe(200);
      expect(list.json<ServiceBody[]>()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: serviceId })]),
      );

      const single = await app.inject({
        method: 'GET',
        url: `/v1/services/${serviceId}`,
        headers: headers(ownerA.accessToken),
      });

      expect(single.statusCode).toBe(200);
      expect(single.json()).toMatchObject({ id: serviceId, name: 'Haircut' });
    });

    it('updates a service and revalidates the deposit', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/services/${serviceId}`,
        headers: headers(ownerA.accessToken),
        payload: { priceCents: 12_000, depositType: 'percentage', depositValue: 25 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        priceCents: 12_000,
        depositType: 'percentage',
        depositValue: 25,
      });

      const invalid = await app.inject({
        method: 'PATCH',
        url: `/v1/services/${serviceId}`,
        headers: headers(ownerA.accessToken),
        payload: { depositType: 'fixed', depositValue: 13_000 },
      });

      expect(invalid.statusCode).toBe(400);
    });
  });

  describe('staff', () => {
    it('creates a staff member with no services', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/staff',
        headers: headers(ownerA.accessToken),
        payload: { name: 'Ana Stylist' },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json<StaffBody>();
      staffId = body.id;

      expect(body).toMatchObject({
        name: 'Ana Stylist',
        active: true,
        services: [],
      });
    });

    it('assigns services to the staff member', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/staff/${staffId}/services`,
        headers: headers(ownerA.accessToken),
        payload: { serviceIds: [serviceId] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<StaffBody>().services).toEqual([
        { id: serviceId, name: 'Haircut', active: true },
      ]);

      const read = await app.inject({
        method: 'GET',
        url: `/v1/staff/${staffId}/services`,
        headers: headers(ownerA.accessToken),
      });

      expect(read.statusCode).toBe(200);
      expect(read.json().services).toHaveLength(1);
    });

    it('rejects services that belong to another tenant', async () => {
      const foreignService = await app.inject({
        method: 'POST',
        url: '/v1/services',
        headers: headers(ownerB.accessToken),
        payload: { name: 'Foreign service', durationMinutes: 30 },
      });
      expect(foreignService.statusCode).toBe(201);

      const response = await app.inject({
        method: 'PUT',
        url: `/v1/staff/${staffId}/services`,
        headers: headers(ownerA.accessToken),
        payload: { serviceIds: [foreignService.json<ServiceBody>().id] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('lists staff with their services', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/staff',
        headers: headers(ownerA.accessToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<StaffBody[]>()).toEqual([
        expect.objectContaining({
          id: staffId,
          services: [expect.objectContaining({ id: serviceId })],
        }),
      ]);
    });

    it('replaces the weekly schedule', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/staff/${staffId}/working-hours`,
        headers: headers(ownerA.accessToken),
        payload: {
          hours: [
            { weekday: 1, startTime: '14:00', endTime: '18:00' },
            { weekday: 1, startTime: '09:00', endTime: '13:00' },
            { weekday: 3, startTime: '10:00', endTime: '16:00' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().hours).toEqual([
        { id: expect.any(String), weekday: 1, startTime: '09:00', endTime: '13:00' },
        { id: expect.any(String), weekday: 1, startTime: '14:00', endTime: '18:00' },
        { id: expect.any(String), weekday: 3, startTime: '10:00', endTime: '16:00' },
      ]);

      const read = await app.inject({
        method: 'GET',
        url: `/v1/staff/${staffId}/working-hours`,
        headers: headers(ownerA.accessToken),
      });

      expect(read.statusCode).toBe(200);
      expect(read.json().hours).toHaveLength(3);
    });

    it('rejects overlapping working hours', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/staff/${staffId}/working-hours`,
        headers: headers(ownerA.accessToken),
        payload: {
          hours: [
            { weekday: 2, startTime: '09:00', endTime: '13:00' },
            { weekday: 2, startTime: '12:00', endTime: '18:00' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('creates, lists and deletes time blocks', async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/v1/staff/${staffId}/time-blocks`,
        headers: headers(ownerA.accessToken),
        payload: {
          startsAt: '2026-11-10T13:00:00Z',
          endsAt: '2026-11-10T15:00:00Z',
          reason: 'Doctor appointment',
        },
      });

      expect(created.statusCode).toBe(201);

      const block = created.json<TimeBlockBody>();
      timeBlockId = block.id;
      expect(block).toMatchObject({
        startsAt: '2026-11-10T13:00:00.000Z',
        endsAt: '2026-11-10T15:00:00.000Z',
        reason: 'Doctor appointment',
      });

      const overlapping = await app.inject({
        method: 'POST',
        url: `/v1/staff/${staffId}/time-blocks`,
        headers: headers(ownerA.accessToken),
        payload: {
          startsAt: '2026-11-10T14:00:00Z',
          endsAt: '2026-11-10T16:00:00Z',
        },
      });
      expect(overlapping.statusCode).toBe(409);

      const inRange = await app.inject({
        method: 'GET',
        url: `/v1/staff/${staffId}/time-blocks?from=2026-11-10T00:00:00Z&to=2026-11-11T00:00:00Z`,
        headers: headers(ownerA.accessToken),
      });
      expect(inRange.statusCode).toBe(200);
      expect(inRange.json<TimeBlockBody[]>()).toEqual([
        expect.objectContaining({ id: timeBlockId }),
      ]);

      const outOfRange = await app.inject({
        method: 'GET',
        url: `/v1/staff/${staffId}/time-blocks?from=2026-11-11T00:00:00Z&to=2026-11-12T00:00:00Z`,
        headers: headers(ownerA.accessToken),
      });
      expect(outOfRange.json<TimeBlockBody[]>()).toEqual([]);

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/v1/staff/${staffId}/time-blocks/${timeBlockId}`,
        headers: headers(ownerA.accessToken),
      });
      expect(deleted.statusCode).toBe(204);

      const deletedAgain = await app.inject({
        method: 'DELETE',
        url: `/v1/staff/${staffId}/time-blocks/${timeBlockId}`,
        headers: headers(ownerA.accessToken),
      });
      expect(deletedAgain.statusCode).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it('hides services and staff from other tenants', async () => {
      const service = await app.inject({
        method: 'GET',
        url: `/v1/services/${serviceId}`,
        headers: headers(ownerB.accessToken),
      });
      expect(service.statusCode).toBe(404);

      const serviceUpdate = await app.inject({
        method: 'PATCH',
        url: `/v1/services/${serviceId}`,
        headers: headers(ownerB.accessToken),
        payload: { name: 'Hijacked' },
      });
      expect(serviceUpdate.statusCode).toBe(404);

      const staff = await app.inject({
        method: 'GET',
        url: `/v1/staff/${staffId}`,
        headers: headers(ownerB.accessToken),
      });
      expect(staff.statusCode).toBe(404);

      const block = await app.inject({
        method: 'POST',
        url: `/v1/staff/${staffId}/time-blocks`,
        headers: headers(ownerB.accessToken),
        payload: {
          startsAt: '2026-12-01T10:00:00Z',
          endsAt: '2026-12-01T11:00:00Z',
        },
      });
      expect(block.statusCode).toBe(404);
    });

    it('enforces roles inside the tenant', async () => {
      // The owner of tenant B joins tenant A as staff.
      await database.db.insert(memberships).values({
        tenantId: ownerA.tenant.id,
        userId: ownerB.user.id,
        role: 'staff',
      });

      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: emailB, password, tenantSlug: slugA },
      });

      expect(login.statusCode).toBe(200);

      const staffToken = login.json<AuthResult>().accessToken;

      const read = await app.inject({
        method: 'GET',
        url: '/v1/services',
        headers: headers(staffToken),
      });
      expect(read.statusCode).toBe(200);

      const create = await app.inject({
        method: 'POST',
        url: '/v1/services',
        headers: headers(staffToken),
        payload: { name: 'Not allowed', durationMinutes: 30 },
      });
      expect(create.statusCode).toBe(403);

      const updateBusiness = await app.inject({
        method: 'PATCH',
        url: '/v1/business',
        headers: headers(staffToken),
        payload: { name: 'Not allowed' },
      });
      expect(updateBusiness.statusCode).toBe(403);
    });
  });

  describe('soft delete', () => {
    it('deactivates a service and filters it from active listings', async () => {
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/v1/services/${serviceId}`,
        headers: headers(ownerA.accessToken),
      });
      expect(deleted.statusCode).toBe(204);

      const stillReadable = await app.inject({
        method: 'GET',
        url: `/v1/services/${serviceId}`,
        headers: headers(ownerA.accessToken),
      });
      expect(stillReadable.statusCode).toBe(200);
      expect(stillReadable.json()).toMatchObject({ active: false });

      const active = await app.inject({
        method: 'GET',
        url: '/v1/services?active=true',
        headers: headers(ownerA.accessToken),
      });
      expect(
        active.json<ServiceBody[]>().some((item) => item.id === serviceId),
      ).toBe(false);

      const inactive = await app.inject({
        method: 'GET',
        url: '/v1/services?active=false',
        headers: headers(ownerA.accessToken),
      });
      expect(
        inactive.json<ServiceBody[]>().some((item) => item.id === serviceId),
      ).toBe(true);
    });

    it('deactivates a staff member', async () => {
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/v1/staff/${staffId}`,
        headers: headers(ownerA.accessToken),
      });
      expect(deleted.statusCode).toBe(204);

      const active = await app.inject({
        method: 'GET',
        url: '/v1/staff?active=true',
        headers: headers(ownerA.accessToken),
      });
      expect(
        active.json<StaffBody[]>().some((item) => item.id === staffId),
      ).toBe(false);
    });
  });
});
