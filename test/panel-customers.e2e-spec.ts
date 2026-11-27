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
 * Panel booking, rescheduling and customer management. Needs Postgres with
 * migrations applied: RUN_DB_TESTS=1 npm run test:e2e
 */
const runDbTests = process.env.RUN_DB_TESTS === '1';

const timezone = 'America/Argentina/Buenos_Aires';
const suffix = `${Date.now()}`.slice(-8);
const slug = `panel-${suffix}`;
const email = `panel-${suffix}@opria.test`;
const password = 'super-secret-passphrase';
const phone = '+54 11 5999 0001';

interface AuthResult {
  accessToken: string;
  tenant: { id: string };
}

interface AppointmentBody {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
}

interface CustomerDetailBody {
  phone: string;
  name: string;
  notes: string | null;
  consentAt: string | null;
  appointmentCount: number;
  history: Array<{ id: string; status: string }>;
}

describe.skipIf(!runDbTests)('panel appointments and customers (e2e)', () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let token: string;
  let serviceId: string;
  let staffId: string;
  let slots: string[];

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${token}`, ...extra };
  }

  async function setupBusiness() {
    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        tenantName: `Panel ${suffix}`,
        tenantSlug: slug,
        name: 'Panel Owner',
        email,
        password,
      },
    });
    expect(registered.statusCode).toBe(201);
    token = registered.json<AuthResult>().accessToken;

    const service = await app.inject({
      method: 'POST',
      url: '/v1/services',
      headers: headers(),
      payload: {
        name: 'Consulta',
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 10_000,
        depositType: 'none',
        depositValue: 0,
      },
    });
    expect(service.statusCode).toBe(201);
    serviceId = service.json<{ id: string }>().id;

    const member = await app.inject({
      method: 'POST',
      url: '/v1/staff',
      headers: headers(),
      payload: { name: 'Ana Panel' },
    });
    expect(member.statusCode).toBe(201);
    staffId = member.json<{ id: string }>().id;

    const date = addDaysToDateKey(localDateKey(new Date(), timezone), 7);
    const assigned = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffId}/services`,
      headers: headers(),
      payload: { serviceIds: [serviceId] },
    });
    expect(assigned.statusCode).toBe(200);

    const hours = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffId}/working-hours`,
      headers: headers(),
      payload: {
        hours: [
          {
            weekday: weekdayFromDateKey(date),
            startTime: '09:00',
            endTime: '12:00',
          },
        ],
      },
    });
    expect(hours.statusCode).toBe(200);

    const availability = await app.inject({
      method: 'GET',
      url: `/v1/availability?serviceId=${serviceId}&date=${date}`,
      headers: headers(),
    });
    expect(availability.statusCode).toBe(200);
    slots = availability
      .json<{ slots: Array<{ startsAt: string }> }>()
      .slots.map((slot) => slot.startsAt)
      .filter((startsAt, index, all) =>
        index === 0
          ? true
          : new Date(startsAt).getTime() - new Date(all[0]).getTime() >=
            45 * 60_000,
      );
    expect(slots.length).toBeGreaterThan(1);
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    database = app.get(DatabaseService);
    await setupBusiness();
  });

  afterAll(async () => {
    if (!app) {
      return;
    }

    await database.db.delete(users).where(eq(users.email, email));
    await database.db.delete(tenants).where(eq(tenants.slug, slug));
    await app.close();
  });

  it('creates a confirmed appointment and replays the idempotency key', async () => {
    const key = `idem-${suffix}-panel`;
    const payload = {
      serviceId,
      staffId,
      startsAt: slots[0],
      customerName: 'Ana Pérez',
      customerPhone: phone,
      customerEmail: 'ana-panel@example.com',
      status: 'confirmed',
      consent: true,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      headers: headers({ 'idempotency-key': key }),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const created = first.json<AppointmentBody>();
    expect(created.status).toBe('confirmed');
    expect(created.endsAt).not.toBe(created.startsAt);

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      headers: headers({ 'idempotency-key': key }),
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<AppointmentBody>().id).toBe(created.id);

    const reused = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      headers: headers({ 'idempotency-key': key }),
      payload: { ...payload, customerName: 'Otro Cliente' },
    });
    expect(reused.statusCode).toBe(409);

    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      headers: headers(),
      payload,
    });
    expect(missingKey.statusCode).toBe(400);
  });

  it('reschedules and notifies, and refuses changes inside the notice window', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/appointments?limit=10',
      headers: headers(),
    });
    expect(list.statusCode).toBe(200);
    const appointment = list
      .json<{ items: AppointmentBody[] }>()
      .items.find((item) => item.status === 'confirmed');
    expect(appointment).toBeDefined();

    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment!.id}/reschedule`,
      headers: headers(),
      payload: { startsAt: slots[1], reason: 'Pedido del cliente' },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json<AppointmentBody>().startsAt).toBe(slots[1]);

    const business = await app.inject({
      method: 'PATCH',
      url: '/v1/business',
      headers: headers(),
      payload: { cancellationHours: 720 },
    });
    expect(business.statusCode).toBe(200);

    const refused = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment!.id}/reschedule`,
      headers: headers(),
      payload: { startsAt: slots[0] },
    });
    expect(refused.statusCode).toBe(409);
  });

  it('lists customers with history, saves notes and consent, and exports CSV', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/customers?q=Ana',
      headers: headers(),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json<{
      items: Array<{ phone: string }>;
      total: number;
    }>();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.map((item) => item.phone)).toContain(phone);

    const saved = await app.inject({
      method: 'PATCH',
      url: `/v1/customers/${encodeURIComponent(phone)}`,
      headers: headers(),
      payload: { notes: 'Prefiere tarde', consent: true },
    });
    expect(saved.statusCode).toBe(200);
    const detail = saved.json<CustomerDetailBody>();
    expect(detail.notes).toBe('Prefiere tarde');
    expect(detail.consentAt).not.toBeNull();
    expect(detail.history.length).toBeGreaterThan(0);

    const csv = await app.inject({
      method: 'GET',
      url: '/v1/customers/export?q=Ana',
      headers: headers(),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('\uFEFF')).toBe(true);
    expect(csv.body).toContain('Prefiere tarde');
  });
});
