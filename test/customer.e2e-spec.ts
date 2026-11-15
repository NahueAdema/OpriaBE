import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  localDateKey,
  weekdayFromDateKey,
} from '../src/availability/availability.js';
import { createApp } from '../src/bootstrap.js';
import { DatabaseService } from '../src/database/database.service.js';
import { customers, tenants, users } from '../src/database/schema/index.js';

/**
 * Customer accounts, appointment ownership and directory filters.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://... npm run test:e2e
 */
const runDbTests = process.env.RUN_DB_TESTS === '1';

const timezone = 'America/Argentina/Buenos_Aires';
const suffix = `${Date.now()}`.slice(-8);
const city = `Rosario ${suffix}`;
const password = 'super-secret-passphrase';
const slug = `customer-${suffix}`;
const ownerEmail = `customer-owner-${suffix}@opria.test`;
const customerEmail = `customer-${suffix}@opria.test`;
const otherCustomerEmail = `customer-other-${suffix}@opria.test`;

interface AuthResult {
  accessToken: string;
  refreshToken: string;
}

interface CustomerAuthResult extends AuthResult {
  customer: { id: string; email: string; name: string; phone: string };
}

interface ServiceBody {
  id: string;
  name: string;
  durationMinutes: number;
}

interface StaffBody {
  id: string;
}

interface CustomerAppointmentBody {
  id: string;
  status: string;
  startsAt: string;
  serviceName: string;
  canCancel: boolean;
  cancellationHours: number;
  business: { slug: string; city: string | null };
}

interface CustomerAppointmentListBody {
  items: CustomerAppointmentBody[];
  total: number;
}

interface AvailabilityBody {
  slots: Array<{ startsAt: string }>;
}

describe.skipIf(!runDbTests)('customer accounts (e2e)', () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let owner: AuthResult;
  let customer: CustomerAuthResult;
  let otherCustomer: CustomerAuthResult;
  let service: ServiceBody;
  let staffMember: StaffBody;
  let targetDate: string;
  let firstSlot: string;
  let secondSlot: string;

  function headers(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  async function registerCustomer(
    email: string,
    name: string,
  ): Promise<CustomerAuthResult> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/register',
      payload: {
        name,
        email,
        phone: '+54 11 5555 0000',
        password,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<CustomerAuthResult>();
  }

  async function getAvailability(): Promise<AvailabilityBody> {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses/${slug}/availability?serviceId=${service.id}&date=${targetDate}`,
    });

    expect(response.statusCode).toBe(200);

    return response.json<AvailabilityBody>();
  }

  async function bookAsCustomer(
    token: string,
    startsAt: string,
  ): Promise<CustomerAppointmentBody> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/customer/appointments',
      headers: headers(token),
      payload: {
        businessSlug: slug,
        serviceId: service.id,
        startsAt,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<CustomerAppointmentBody>();
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    database = app.get(DatabaseService);

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        tenantName: `Estudio Cliente ${suffix}`,
        tenantSlug: slug,
        name: 'Customer Owner',
        email: ownerEmail,
        password,
      },
    });
    expect(registered.statusCode).toBe(201);
    owner = registered.json<AuthResult>();

    const business = await app.inject({
      method: 'PATCH',
      url: '/v1/business',
      headers: headers(owner.accessToken),
      payload: { city, cancellationHours: 0 },
    });
    expect(business.statusCode).toBe(200);

    const createdService = await app.inject({
      method: 'POST',
      url: '/v1/services',
      headers: headers(owner.accessToken),
      payload: {
        name: `Consulta ${suffix}`,
        durationMinutes: 30,
        bufferMinutes: 10,
        priceCents: 15_000,
        depositType: 'fixed',
        depositValue: 5_000,
      },
    });
    expect(createdService.statusCode).toBe(201);
    service = createdService.json<ServiceBody>();

    const createdStaff = await app.inject({
      method: 'POST',
      url: '/v1/staff',
      headers: headers(owner.accessToken),
      payload: { name: 'Ana Cliente' },
    });
    expect(createdStaff.statusCode).toBe(201);
    staffMember = createdStaff.json<StaffBody>();

    const assigned = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffMember.id}/services`,
      headers: headers(owner.accessToken),
      payload: { serviceIds: [service.id] },
    });
    expect(assigned.statusCode).toBe(200);

    targetDate = addDaysToDateKey(localDateKey(new Date(), timezone), 7);

    const hours = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffMember.id}/working-hours`,
      headers: headers(owner.accessToken),
      payload: {
        hours: [
          {
            weekday: weekdayFromDateKey(targetDate),
            startTime: '09:00',
            endTime: '12:00',
          },
        ],
      },
    });
    expect(hours.statusCode).toBe(200);

    const availability = await getAvailability();
    expect(availability.slots.length).toBeGreaterThan(1);
    firstSlot = availability.slots[0].startsAt;
    secondSlot = availability.slots[1].startsAt;

    customer = await registerCustomer(customerEmail, 'Cliente Uno');
    otherCustomer = await registerCustomer(otherCustomerEmail, 'Cliente Dos');
  });

  afterAll(async () => {
    if (!app) {
      return;
    }

    await database.db.delete(customers).where(eq(customers.email, customerEmail));
    await database.db
      .delete(customers)
      .where(eq(customers.email, otherCustomerEmail));
    await database.db.delete(users).where(eq(users.email, ownerEmail));
    await database.db.delete(tenants).where(eq(tenants.slug, slug));
    await app.close();
  });

  it('registers, signs in and returns the customer profile', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/v1/customer-auth/me',
      headers: headers(customer.accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      email: customerEmail,
      name: 'Cliente Uno',
      phone: '+54 11 5555 0000',
    });

    const login = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/login',
      payload: { email: customerEmail, password },
    });
    expect(login.statusCode).toBe(200);
    expect(
      login.json<CustomerAuthResult>().customer.email,
    ).toBe(customerEmail);

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/login',
      payload: { email: customerEmail, password: 'wrong-password' },
    });
    expect(wrongPassword.statusCode).toBe(401);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/register',
      payload: {
        name: 'Cliente Uno',
        email: customerEmail,
        phone: '+54 11 5555 0000',
        password,
      },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rotates refresh tokens and rejects a replayed token', async () => {
    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/refresh',
      payload: { refreshToken: customer.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);

    const rotated = refreshed.json<CustomerAuthResult>();
    expect(rotated.refreshToken).not.toBe(customer.refreshToken);

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/refresh',
      payload: { refreshToken: customer.refreshToken },
    });
    expect(replay.statusCode).toBe(401);

    // Any token of the same family is now revoked, including the new one.
    const familyRevoked = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/refresh',
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(familyRevoked.statusCode).toBe(401);

    // Keep a usable session for the rest of the suite.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/login',
      payload: { email: customerEmail, password },
    });
    expect(login.statusCode).toBe(200);
    customer = login.json<CustomerAuthResult>();
  });

  it('keeps staff and customer tokens in separate realms', async () => {
    const staffTokenAsCustomer = await app.inject({
      method: 'GET',
      url: '/v1/customer/appointments',
      headers: headers(owner.accessToken),
    });
    expect(staffTokenAsCustomer.statusCode).toBe(401);

    const customerTokenAsStaff = await app.inject({
      method: 'GET',
      url: '/v1/appointments',
      headers: headers(customer.accessToken),
    });
    expect(customerTokenAsStaff.statusCode).toBe(401);
  });

  it('lists cities and service names for the directory filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/public/businesses/filters',
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<{ cities: string[]; services: string[] }>();
    expect(body.cities).toContain(city);
    expect(body.services).toContain(`Consulta ${suffix}`);
  });

  it('filters the directory by city and service', async () => {
    const byCity = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses?city=${encodeURIComponent(city)}`,
    });
    expect(byCity.statusCode).toBe(200);
    expect(
      byCity.json<{ items: Array<{ slug: string; city: string | null }> }>().items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug, city }),
      ]),
    );

    const byService = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses?service=${encodeURIComponent(`Consulta ${suffix}`)}`,
    });
    expect(byService.statusCode).toBe(200);
    expect(
      byService.json<{ items: Array<{ slug: string }> }>().items.map(
        (item) => item.slug,
      ),
    ).toContain(slug);

    const wrongCity = await app.inject({
      method: 'GET',
      url: '/v1/public/businesses?city=Ciudad%20Inexistente',
    });
    expect(wrongCity.statusCode).toBe(200);
    expect(
      wrongCity.json<{ items: Array<{ slug: string }> }>().items.map(
        (item) => item.slug,
      ),
    ).not.toContain(slug);
  });

  it('books with the account data and shows the appointment to its owner only', async () => {
    const created = await bookAsCustomer(customer.accessToken, firstSlot);
    expect(created.status).toBe('pending');
    expect(created.serviceName).toBe(`Consulta ${suffix}`);
    expect(created.business).toMatchObject({ slug, city });
    expect(created.canCancel).toBe(true);

    const mine = await app.inject({
      method: 'GET',
      url: '/v1/customer/appointments',
      headers: headers(customer.accessToken),
    });
    expect(mine.statusCode).toBe(200);
    const list = mine.json<CustomerAppointmentListBody>();
    expect(list.items.map((item) => item.id)).toContain(created.id);

    const others = await app.inject({
      method: 'GET',
      url: '/v1/customer/appointments',
      headers: headers(otherCustomer.accessToken),
    });
    expect(others.statusCode).toBe(200);
    expect(others.json<CustomerAppointmentListBody>().items).toHaveLength(0);

    const foreignCancel = await app.inject({
      method: 'POST',
      url: `/v1/customer/appointments/${created.id}/cancel`,
      headers: headers(otherCustomer.accessToken),
    });
    expect(foreignCancel.statusCode).toBe(404);
  });

  it('cancels outside the configured window and frees the slot', async () => {
    const mine = await app.inject({
      method: 'GET',
      url: '/v1/customer/appointments',
      headers: headers(customer.accessToken),
    });
    const appointment = mine.json<CustomerAppointmentListBody>().items[0];

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/customer/appointments/${appointment.id}/cancel`,
      headers: headers(customer.accessToken),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<CustomerAppointmentBody>()).toMatchObject({
      status: 'cancelled',
      canCancel: false,
    });

    const availability = await getAvailability();
    expect(availability.slots.map((slot) => slot.startsAt)).toContain(
      appointment.startsAt,
    );

    const twice = await app.inject({
      method: 'POST',
      url: `/v1/customer/appointments/${appointment.id}/cancel`,
      headers: headers(customer.accessToken),
    });
    expect(twice.statusCode).toBe(409);
  });

  it('blocks cancellation inside cancellationHours', async () => {
    await bookAsCustomer(customer.accessToken, secondSlot);

    const policy = await app.inject({
      method: 'PATCH',
      url: '/v1/business',
      headers: headers(owner.accessToken),
      payload: { cancellationHours: 720 },
    });
    expect(policy.statusCode).toBe(200);

    const mine = await app.inject({
      method: 'GET',
      url: '/v1/customer/appointments',
      headers: headers(customer.accessToken),
    });
    const appointment = mine
      .json<CustomerAppointmentListBody>()
      .items.find((item) => item.status === 'pending');
    expect(appointment).toBeDefined();

    const blocked = await app.inject({
      method: 'POST',
      url: `/v1/customer/appointments/${appointment!.id}/cancel`,
      headers: headers(customer.accessToken),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body).toContain('720 hours');
  });
});
