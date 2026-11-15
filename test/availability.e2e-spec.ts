import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  localDateKey,
  weekdayFromDateKey,
  zonedDateTimeToUtc,
} from '../src/availability/availability.js';
import { createApp } from '../src/bootstrap.js';
import { DatabaseService } from '../src/database/database.service.js';
import { tenants, users } from '../src/database/schema/index.js';

/**
 * These tests need a reachable Postgres with migrations applied:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://... npm run test:e2e
 */
const runDbTests = process.env.RUN_DB_TESTS === '1';

const timezone = 'America/Argentina/Buenos_Aires';
const suffix = `${Date.now()}`.slice(-8);
const password = 'super-secret-passphrase';
const slugA = `avail-a-${suffix}`;
const slugB = `avail-b-${suffix}`;
const emailA = `avail-a-${suffix}@opria.test`;
const emailB = `avail-b-${suffix}@opria.test`;

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
  tenant: { id: string; slug: string; role: string };
}

interface ServiceBody {
  id: string;
  durationMinutes: number;
  bufferMinutes: number;
}

interface StaffBody {
  id: string;
  name: string;
}

interface AvailabilitySlotBody {
  startsAt: string;
  endsAt: string;
  staffIds: string[];
}

interface AvailabilityBody {
  date: string;
  timezone: string;
  serviceId: string;
  durationMinutes: number;
  bufferMinutes: number;
  slots: AvailabilitySlotBody[];
}

describe.skipIf(!runDbTests)('availability (e2e)', () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let ownerA: AuthResult;
  let ownerB: AuthResult;
  let serviceA: ServiceBody;
  let serviceB: ServiceBody;
  let staffA1: StaffBody;
  let staffA2: StaffBody;
  let staffUnassigned: StaffBody;
  let staffB: StaffBody;
  let targetDate: string;
  let weekday: number;

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
        name: 'Availability Owner',
        email,
        password,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<AuthResult>();
  }

  async function createService(
    token: string,
    name: string,
  ): Promise<ServiceBody> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/services',
      headers: headers(token),
      payload: {
        name,
        durationMinutes: 30,
        bufferMinutes: 15,
        priceCents: 5_000,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<ServiceBody>();
  }

  async function createStaff(
    token: string,
    name: string,
  ): Promise<StaffBody> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/staff',
      headers: headers(token),
      payload: { name },
    });

    expect(response.statusCode).toBe(201);

    return response.json<StaffBody>();
  }

  async function assign(token: string, staffId: string, serviceId: string) {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffId}/services`,
      headers: headers(token),
      payload: { serviceIds: [serviceId] },
    });

    expect(response.statusCode).toBe(200);
  }

  async function setMondayToFridayWindow(
    token: string,
    staffId: string,
    day: number,
  ) {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffId}/working-hours`,
      headers: headers(token),
      payload: {
        hours: [{ weekday: day, startTime: '09:00', endTime: '12:00' }],
      },
    });

    expect(response.statusCode).toBe(200);
  }

  async function getAvailability(
    token: string,
    query: { serviceId: string; date: string; staffId?: string },
  ): Promise<AvailabilityBody> {
    const search = new URLSearchParams({
      serviceId: query.serviceId,
      date: query.date,
    });

    if (query.staffId) {
      search.set('staffId', query.staffId);
    }

    const response = await app.inject({
      method: 'GET',
      url: `/v1/availability?${search.toString()}`,
      headers: headers(token),
    });

    expect(response.statusCode).toBe(200);

    return response.json<AvailabilityBody>();
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    database = app.get(DatabaseService);

    ownerA = await register(slugA, emailA, 'Availability A');
    ownerB = await register(slugB, emailB, 'Availability B');

    serviceA = await createService(ownerA.accessToken, 'Availability cut');
    serviceB = await createService(ownerB.accessToken, 'Foreign cut');

    staffA1 = await createStaff(ownerA.accessToken, 'Ana Availability');
    staffA2 = await createStaff(ownerA.accessToken, 'Beto Availability');
    staffUnassigned = await createStaff(
      ownerA.accessToken,
      'Caro Unassigned',
    );
    staffB = await createStaff(ownerB.accessToken, 'Foreign Staff');

    await assign(ownerA.accessToken, staffA1.id, serviceA.id);
    await assign(ownerA.accessToken, staffA2.id, serviceA.id);
    await assign(ownerB.accessToken, staffB.id, serviceB.id);

    // Seven days ahead is inside the default 90-day booking window.
    targetDate = addDaysToDateKey(localDateKey(new Date(), timezone), 7);
    weekday = weekdayFromDateKey(targetDate);

    await setMondayToFridayWindow(ownerA.accessToken, staffA1.id, weekday);
    await setMondayToFridayWindow(ownerA.accessToken, staffA2.id, weekday);
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

  it('returns the service buffer and the merged slots of every eligible staff', async () => {
    const body = await getAvailability(ownerA.accessToken, {
      serviceId: serviceA.id,
      date: targetDate,
    });

    expect(body).toMatchObject({
      date: targetDate,
      timezone,
      serviceId: serviceA.id,
      durationMinutes: 30,
      bufferMinutes: 15,
    });

    // 09:00-12:00, 30-minute service plus a 15-minute buffer, every 15 min.
    expect(body.slots).toHaveLength(10);
    expect(body.slots[0]?.startsAt).toBe(
      zonedDateTimeToUtc(targetDate, '09:00', timezone)?.toISOString(),
    );
    expect(body.slots[0]?.endsAt).toBe(
      zonedDateTimeToUtc(targetDate, '09:30', timezone)?.toISOString(),
    );
    expect(body.slots.every((slot) => slot.staffIds.length === 2)).toBe(true);
    expect(body.slots[0]?.staffIds).toEqual(
      [staffA1.id, staffA2.id].sort(),
    );
  });

  it('restricts the result to one staff member', async () => {
    const body = await getAvailability(ownerA.accessToken, {
      serviceId: serviceA.id,
      date: targetDate,
      staffId: staffA1.id,
    });

    expect(body.slots).toHaveLength(10);
    expect(body.slots.every((slot) => slot.staffIds.length === 1)).toBe(true);
    expect(body.slots[0]?.staffIds).toEqual([staffA1.id]);
  });

  it('removes the slots blocked by a time block', async () => {
    const startsAt = zonedDateTimeToUtc(targetDate, '10:00', timezone);
    const endsAt = zonedDateTimeToUtc(targetDate, '11:00', timezone);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/staff/${staffA1.id}/time-blocks`,
      headers: headers(ownerA.accessToken),
      payload: {
        startsAt: startsAt?.toISOString(),
        endsAt: endsAt?.toISOString(),
        reason: 'Availability test block',
      },
    });
    expect(created.statusCode).toBe(201);

    // Only Ana is blocked; Beto still offers the full window.
    const ana = await getAvailability(ownerA.accessToken, {
      serviceId: serviceA.id,
      date: targetDate,
      staffId: staffA1.id,
    });

    expect(ana.slots).toHaveLength(5);
    expect(ana.slots.map((slot) => slot.startsAt)).not.toContain(
      startsAt?.toISOString(),
    );
    expect(ana.slots.at(-1)?.startsAt).toBe(
      zonedDateTimeToUtc(targetDate, '11:15', timezone)?.toISOString(),
    );

    const both = await getAvailability(ownerA.accessToken, {
      serviceId: serviceA.id,
      date: targetDate,
    });

    expect(both.slots).toHaveLength(10);
    expect(
      both.slots.find(
        (slot) => slot.startsAt === startsAt?.toISOString(),
      )?.staffIds,
    ).toEqual([staffA2.id]);
  });

  it('returns no slots on a day without working hours', async () => {
    const body = await getAvailability(ownerA.accessToken, {
      serviceId: serviceA.id,
      date: addDaysToDateKey(targetDate, 1),
    });

    expect(body.slots).toEqual([]);
  });

  it('rejects staff members that do not perform the service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/availability?serviceId=${serviceA.id}&date=${targetDate}&staffId=${staffUnassigned.id}`,
      headers: headers(ownerA.accessToken),
    });

    expect(response.statusCode).toBe(400);
  });

  it('hides services and staff from other tenants', async () => {
    const foreignService = await app.inject({
      method: 'GET',
      url: `/v1/availability?serviceId=${serviceB.id}&date=${targetDate}`,
      headers: headers(ownerA.accessToken),
    });
    expect(foreignService.statusCode).toBe(404);

    const foreignStaff = await app.inject({
      method: 'GET',
      url: `/v1/availability?serviceId=${serviceA.id}&date=${targetDate}&staffId=${staffB.id}`,
      headers: headers(ownerA.accessToken),
    });
    expect(foreignStaff.statusCode).toBe(404);
  });

  it('validates the query and requires authentication', async () => {
    const invalidDate = await app.inject({
      method: 'GET',
      url: `/v1/availability?serviceId=${serviceA.id}&date=2026-02-30`,
      headers: headers(ownerA.accessToken),
    });
    expect(invalidDate.statusCode).toBe(400);

    const missingService = await app.inject({
      method: 'GET',
      url: `/v1/availability?date=${targetDate}`,
      headers: headers(ownerA.accessToken),
    });
    expect(missingService.statusCode).toBe(400);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/availability?serviceId=${serviceA.id}&date=${targetDate}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('hides an inactive service', async () => {
    const deactivated = await app.inject({
      method: 'DELETE',
      url: `/v1/services/${serviceA.id}`,
      headers: headers(ownerA.accessToken),
    });
    expect(deactivated.statusCode).toBe(204);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/availability?serviceId=${serviceA.id}&date=${targetDate}`,
      headers: headers(ownerA.accessToken),
    });
    expect(response.statusCode).toBe(404);
  });
});
