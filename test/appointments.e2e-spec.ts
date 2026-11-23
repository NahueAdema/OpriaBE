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
const slug = `booking-${suffix}`;
const email = `booking-${suffix}@opria.test`;
const businessName = `Estudio Booking ${suffix}`;

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
  tenant: { id: string; slug: string; role: string };
}

interface ServiceBody {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
}

interface StaffBody {
  id: string;
  name: string;
}

interface AppointmentBody {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  priceCents: number;
  depositType: string;
  depositValue: number;
}

interface AppointmentListBody {
  items: AppointmentBody[];
  total: number;
}

interface PublicAvailabilityBody {
  date: string;
  slots: Array<{ startsAt: string; endsAt: string }>;
}

interface CalendarBody {
  days: Array<{ date: string; available: boolean; slots: number }>;
}

interface PublicAppointmentBody {
  id: string;
  status: string;
  startsAt: string;
  serviceName: string;
  staffName: string;
  customerName: string;
  business: { name: string; slug: string; timezone: string };
}

describe.skipIf(!runDbTests)('appointments and public booking (e2e)', () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let owner: AuthResult;
  let service: ServiceBody;
  let staffMember: StaffBody;
  let targetDate: string;
  let firstSlot: string;
  let secondSlot: string;

  function headers(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  async function register(): Promise<AuthResult> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        tenantName: businessName,
        tenantSlug: slug,
        name: 'Booking Owner',
        email,
        password,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<AuthResult>();
  }

  async function createService(): Promise<ServiceBody> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/services',
      headers: headers(owner.accessToken),
      payload: {
        name: 'Consulta',
        durationMinutes: 30,
        bufferMinutes: 10,
        priceCents: 15_000,
        depositType: 'fixed',
        depositValue: 5_000,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<ServiceBody>();
  }

  async function createStaff(): Promise<StaffBody> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/staff',
      headers: headers(owner.accessToken),
      payload: { name: 'Ana Booking' },
    });

    expect(response.statusCode).toBe(201);

    return response.json<StaffBody>();
  }

  async function configureSchedule() {
    const assigned = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffMember.id}/services`,
      headers: headers(owner.accessToken),
      payload: { serviceIds: [service.id] },
    });
    expect(assigned.statusCode).toBe(200);

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
  }

  async function getPublicAvailability(
    date: string,
  ): Promise<PublicAvailabilityBody> {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses/${slug}/availability?serviceId=${service.id}&date=${date}`,
    });

    expect(response.statusCode).toBe(200);

    return response.json<PublicAvailabilityBody>();
  }

  async function book(
    startsAt: string,
    customerName: string,
    clientIp?: string,
  ) {
    return app.inject({
      method: 'POST',
      url: `/v1/public/businesses/${slug}/appointments`,
      // A distinct forwarded IP keeps the per-route throttle out of the way.
      headers: clientIp ? { 'x-forwarded-for': clientIp } : undefined,
      payload: {
        serviceId: service.id,
        startsAt,
        customerName,
        customerPhone: '+54 11 5555 0000',
        customerEmail: `guest-${suffix}@guest.test`,
      },
    });
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    database = app.get(DatabaseService);

    owner = await register();
    service = await createService();
    staffMember = await createStaff();

    // Pick a date far enough ahead to clear the minimum notice, then look at
    // the real availability so the test never hardcodes a slot.
    targetDate = addDaysToDateKey(localDateKey(new Date(), timezone), 7);
    await configureSchedule();

    const availability = await getPublicAvailability(targetDate);
    expect(availability.slots.length).toBeGreaterThan(1);
    firstSlot = availability.slots[0].startsAt;

    // Leave room for the 30 min service + 10 min buffer booked by other cases.
    const distantSlot = availability.slots.find(
      (slot) =>
        new Date(slot.startsAt).getTime() - new Date(firstSlot).getTime() >=
        45 * 60_000,
    );
    expect(distantSlot).toBeDefined();
    secondSlot = distantSlot?.startsAt ?? firstSlot;
  });

  afterAll(async () => {
    if (!app) {
      return;
    }

    await database.db.delete(users).where(eq(users.email, email));
    await database.db.delete(tenants).where(eq(tenants.slug, slug));
    await app.close();
  });

  it('exposes the business publicly by slug and in the search', async () => {
    const profile = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses/${slug}`,
    });
    expect(profile.statusCode).toBe(200);

    const body = profile.json<{
      name: string;
      timezone: string;
      services: Array<{ id: string; priceCents: number }>;
    }>();
    expect(body.name).toBe(businessName);
    expect(body.timezone).toBe(timezone);
    expect(body.services.map((item) => item.id)).toContain(service.id);

    const search = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses?q=${encodeURIComponent(`Booking ${suffix}`)}`,
    });
    expect(search.statusCode).toBe(200);
    expect(
      search
        .json<{ items: Array<{ slug: string }> }>()
        .items.map((item) => item.slug),
    ).toContain(slug);
  });

  it('marks the target day as available in the public calendar', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses/${slug}/calendar?serviceId=${service.id}&from=${targetDate}&to=${targetDate}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<CalendarBody>();
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ date: targetDate, available: true });
    expect(body.days[0].slots).toBeGreaterThan(0);
  });

  it('creates a pending appointment and blocks the slot', async () => {
    const response = await book(firstSlot, 'Guest One');

    expect(response.statusCode).toBe(201);

    const created = response.json<PublicAppointmentBody>();
    expect(created.status).toBe('pending');
    expect(created.startsAt).toBe(firstSlot);
    expect(created.serviceName).toBe('Consulta');
    expect(created.customerName).toBe('Guest One');
    expect(created.business).toMatchObject({ slug, name: businessName });

    const availability = await getPublicAvailability(targetDate);
    expect(availability.slots.map((slot) => slot.startsAt)).not.toContain(
      firstSlot,
    );
  });

  it('refuses a second booking for the same slot', async () => {
    const response = await book(firstSlot, 'Guest Two');

    expect(response.statusCode).toBe(409);
  });

  it('shows the pending request in the tenant agenda', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/appointments?status=pending&limit=10`,
      headers: headers(owner.accessToken),
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<AppointmentListBody>();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      status: 'pending',
      startsAt: firstSlot,
      customerName: 'Guest One',
      priceCents: 15_000,
      depositType: 'fixed',
      depositValue: 5_000,
    });
  });

  it('frees the slot when the business rejects the request', async () => {
    const pending = await app.inject({
      method: 'GET',
      url: '/v1/appointments?status=pending&limit=1',
      headers: headers(owner.accessToken),
    });
    const appointmentId = pending.json<AppointmentListBody>().items[0].id;

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointmentId}/status`,
      headers: headers(owner.accessToken),
      payload: { status: 'rejected', reason: 'Sin disponibilidad' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json<AppointmentBody>()).toMatchObject({
      status: 'rejected',
      statusReason: 'Sin disponibilidad',
    });

    const availability = await getPublicAvailability(targetDate);
    expect(availability.slots.map((slot) => slot.startsAt)).toContain(
      firstSlot,
    );

    const rebooked = await book(firstSlot, 'Guest Three');
    expect(rebooked.statusCode).toBe(201);
    expect(rebooked.json<PublicAppointmentBody>().status).toBe('pending');
  });

  it('keeps the slot blocked after confirming', async () => {
    const pending = await app.inject({
      method: 'GET',
      url: '/v1/appointments?status=pending&limit=1',
      headers: headers(owner.accessToken),
    });
    const appointmentId = pending.json<AppointmentListBody>().items[0].id;

    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointmentId}/status`,
      headers: headers(owner.accessToken),
      payload: { status: 'confirmed' },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<AppointmentBody>().status).toBe('confirmed');

    const availability = await getPublicAvailability(targetDate);
    expect(availability.slots.map((slot) => slot.startsAt)).not.toContain(
      firstSlot,
    );
  });

  it('rejects an invalid status change', async () => {
    const confirmed = await app.inject({
      method: 'GET',
      url: '/v1/appointments?status=confirmed&limit=1',
      headers: headers(owner.accessToken),
    });
    const appointmentId = confirmed.json<AppointmentListBody>().items[0].id;

    const backToPending = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointmentId}/status`,
      headers: headers(owner.accessToken),
      payload: { status: 'pending' },
    });
    expect(backToPending.statusCode).toBe(400);

    const backToRejected = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointmentId}/status`,
      headers: headers(owner.accessToken),
      payload: { status: 'rejected' },
    });
    expect(backToRejected.statusCode).toBe(409);
  });

  it('rejects unknown businesses, services and foreign appointments', async () => {
    const unknownBusiness = await app.inject({
      method: 'GET',
      url: '/v1/public/businesses/does-not-exist-here',
    });
    expect(unknownBusiness.statusCode).toBe(404);

    const unknownService = await app.inject({
      method: 'POST',
      url: `/v1/public/businesses/${slug}/appointments`,
      payload: {
        serviceId: '00000000-0000-4000-8000-000000000000',
        startsAt: firstSlot,
        customerName: 'Guest Four',
        customerPhone: '+54 11 5555 0000',
      },
    });
    expect(unknownService.statusCode).toBe(404);

    const foreignAppointment = await app.inject({
      method: 'PATCH',
      url: '/v1/appointments/00000000-0000-4000-8000-000000000000/status',
      headers: headers(owner.accessToken),
      payload: { status: 'confirmed' },
    });
    expect(foreignAppointment.statusCode).toBe(404);
  });

  it('requires authentication for the tenant agenda', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/appointments',
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a booking for a time outside the availability', async () => {
    const response = await book(`${targetDate}T03:00:00.000Z`, 'Guest Five');

    expect(response.statusCode).toBe(409);
  });

  it('accepts only one of two concurrent bookings for the same slot', async () => {
    // Different forwarded IPs avoid the 5/min public-booking throttle; the
    // anti-double-booking guard must be the database lock, not the rate limit.
    const [first, second] = await Promise.all([
      book(secondSlot, 'Concurrent One', '198.51.100.10'),
      book(secondSlot, 'Concurrent Two', '198.51.100.11'),
    ]);

    expect([first.statusCode, second.statusCode].sort((a, b) => a - b)).toEqual(
      [201, 409],
    );

    const winner = first.statusCode === 201 ? first : second;
    expect(winner.json<PublicAppointmentBody>().startsAt).toBe(secondSlot);

    const availability = await getPublicAvailability(targetDate);
    expect(availability.slots.map((slot) => slot.startsAt)).not.toContain(
      secondSlot,
    );
  });
});
