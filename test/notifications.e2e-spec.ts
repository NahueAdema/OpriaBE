import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import {
  addDaysToDateKey,
  localDateKey,
  weekdayFromDateKey,
} from '../src/availability/availability.js';
import { createApp } from '../src/bootstrap.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  customers,
  notificationJobs,
  notificationLog,
  tenants,
  users,
} from '../src/database/schema/index.js';
import type { NotificationJob } from '../src/database/schema/index.js';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type NotificationMessage,
} from '../src/notifications/email.provider.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import {
  SIGNED_LINKS,
  SignedLinksService,
} from '../src/notifications/signed-links.js';

/**
 * End-to-end coverage for the notification outbox with a fake mailer.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://... npm run test:e2e
 *
 * Other suites create appointments too, so each worker call marks only the job
 * under test as due and processes a batch of one. Assertions then look at the
 * rows and messages belonging to this tenant instead of global counters.
 */
const runDbTests = process.env.RUN_DB_TESTS === '1';

const timezone = 'America/Argentina/Buenos_Aires';
const suffix = `${Date.now()}`.slice(-8);
const slug = `notifications-${suffix}`;
const businessName = `Estudio Notificaciones ${suffix}`;
const ownerEmail = `notifications-owner-${suffix}@opria.test`;
const businessEmail = `notifications-business-${suffix}@opria.test`;
const guestEmail = `notifications-guest-${suffix}@opria.test`;
const guest2Email = `notifications-guest2-${suffix}@opria.test`;
const guest3Email = `notifications-guest3-${suffix}@opria.test`;
const customerEmail = `notifications-customer-${suffix}@opria.test`;
const password = 'super-secret-passphrase';
const OLD = new Date('2000-01-01T00:00:00.000Z');

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
  tenant: { id: string; slug: string; role: string };
}

interface CustomerAuthResult {
  accessToken: string;
}

interface ServiceBody {
  id: string;
}

interface StaffBody {
  id: string;
}

interface AppointmentBody {
  id: string;
  status: string;
  startsAt: string;
}

interface AvailabilityBody {
  slots: Array<{ startsAt: string }>;
}

interface ProcessBody {
  processed: number;
  failed: number;
}

describe.skipIf(!runDbTests)('notifications (e2e)', () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let sendSpy: MockInstance<EmailProvider['send']>;
  let sent: NotificationMessage[] = [];
  let owner: AuthResult;
  let customer: CustomerAuthResult;
  let service: ServiceBody;
  let staffMember: StaffBody;
  let slots: string[];
  let guestAppointmentId: string;
  let workerSecret: string;

  function headers(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  function workerHeaders(secret: string): Record<string, string> {
    return { 'x-notification-secret': secret };
  }

  async function jobsFor(appointmentId: string): Promise<NotificationJob[]> {
    return database.db
      .select()
      .from(notificationJobs)
      .where(eq(notificationJobs.appointmentId, appointmentId))
      .orderBy(notificationJobs.type);
  }

  async function jobOf(
    appointmentId: string,
    type: string,
  ): Promise<NotificationJob> {
    const [job] = await database.db
      .select()
      .from(notificationJobs)
      .where(
        and(
          eq(notificationJobs.appointmentId, appointmentId),
          eq(notificationJobs.type, type),
        ),
      )
      .limit(1);

    expect(job).toBeDefined();

    return job as NotificationJob;
  }

  /** Puts one of our jobs at the front of the queue without touching others. */
  async function makeDue(
    appointmentId: string,
    type: string,
    attempts = 0,
  ): Promise<NotificationJob> {
    const job = await jobOf(appointmentId, type);

    await database.db
      .update(notificationJobs)
      .set({
        scheduledAt: OLD,
        status: 'pending',
        attempts,
        nextAttemptAt: null,
        lockedAt: null,
        lastError: null,
      })
      .where(eq(notificationJobs.id, job.id));

    return job;
  }

  async function processJobs(limit = 1) {
    return app.inject({
      method: 'POST',
      url: '/v1/notifications/process',
      headers: workerHeaders(workerSecret),
      payload: { limit },
    });
  }

  async function messagesTo(recipient: string): Promise<NotificationMessage[]> {
    return sent.filter((message) => message.to === recipient);
  }

  async function bookGuest(
    startsAt: string,
    name: string,
    email: string,
    ip: string,
  ): Promise<AppointmentBody> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/public/businesses/${slug}/appointments`,
      headers: { 'x-forwarded-for': ip },
      payload: {
        serviceId: service.id,
        startsAt,
        customerName: name,
        customerPhone: '+54 11 5555 0000',
        customerEmail: email,
      },
    });

    expect(response.statusCode).toBe(201);

    return response.json<AppointmentBody>();
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    database = app.get(DatabaseService);
    workerSecret =
      process.env.NOTIFICATION_WORKER_SECRET ??
      process.env.JWT_ACCESS_SECRET ??
      'test-secret-with-at-least-32-characters!!';

    const mailer = app.get<EmailProvider>(EMAIL_PROVIDER);
    sendSpy = vi.spyOn(mailer, 'send');

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        tenantName: businessName,
        tenantSlug: slug,
        name: 'Notification Owner',
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
      payload: { contactEmail: businessEmail, cancellationHours: 0 },
    });
    expect(business.statusCode).toBe(200);

    const createdService = await app.inject({
      method: 'POST',
      url: '/v1/services',
      headers: headers(owner.accessToken),
      payload: {
        name: 'Consulta',
        durationMinutes: 30,
        bufferMinutes: 10,
        priceCents: 15_000,
        depositType: 'none',
        depositValue: 0,
      },
    });
    expect(createdService.statusCode).toBe(201);
    service = createdService.json<ServiceBody>();

    const createdStaff = await app.inject({
      method: 'POST',
      url: '/v1/staff',
      headers: headers(owner.accessToken),
      payload: { name: 'Ana Notificaciones' },
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

    const targetDate = addDaysToDateKey(localDateKey(new Date(), timezone), 7);
    const hours = await app.inject({
      method: 'PUT',
      url: `/v1/staff/${staffMember.id}/working-hours`,
      headers: headers(owner.accessToken),
      payload: {
        hours: [
          {
            weekday: weekdayFromDateKey(targetDate),
            startTime: '09:00',
            endTime: '14:00',
          },
        ],
      },
    });
    expect(hours.statusCode).toBe(200);

    const availability = await app.inject({
      method: 'GET',
      url: `/v1/public/businesses/${slug}/availability?serviceId=${service.id}&date=${targetDate}`,
    });
    expect(availability.statusCode).toBe(200);
    slots = availability
      .json<AvailabilityBody>()
      .slots.map((slot) => slot.startsAt);
    expect(slots.length).toBeGreaterThanOrEqual(5);

    const registeredCustomer = await app.inject({
      method: 'POST',
      url: '/v1/customer-auth/register',
      payload: {
        name: 'Cliente Notificaciones',
        email: customerEmail,
        phone: '+54 11 5555 0000',
        password,
      },
    });
    expect(registeredCustomer.statusCode).toBe(201);
    customer = registeredCustomer.json<CustomerAuthResult>();
  });

  beforeEach(() => {
    sent = [];
    sendSpy.mockReset();
    sendSpy.mockImplementation(async (message) => {
      sent.push(message);
    });
  });

  afterAll(async () => {
    if (!app) {
      return;
    }

    await database.db
      .delete(customers)
      .where(eq(customers.email, customerEmail));
    await database.db.delete(users).where(eq(users.email, ownerEmail));
    await database.db.delete(tenants).where(eq(tenants.slug, slug));
    vi.restoreAllMocks();
    await app.close();
  });

  it('requires the worker secret to process jobs', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/notifications/process',
      payload: { limit: 1 },
    });
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/notifications/process',
      headers: workerHeaders('not-the-secret'),
      payload: { limit: 1 },
    });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('enqueues confirmation and reminders on a guest booking, sending once', async () => {
    const appointment = await bookGuest(
      slots[0],
      'Ana Guest',
      guestEmail,
      '198.51.100.21',
    );

    guestAppointmentId = appointment.id;

    const jobs = await jobsFor(appointment.id);
    expect(jobs.map((job) => job.type)).toEqual([
      'appointment_confirmation',
      'appointment_reminder_24h',
      'appointment_reminder_2h',
    ]);
    expect(new Set(jobs.map((job) => job.dedupeKey)).size).toBe(3);
    expect(jobs[1].appointmentId).toBe(appointment.id);

    await makeDue(appointment.id, 'appointment_confirmation');
    const result = await processJobs();

    expect(result.statusCode).toBe(200);
    expect(result.json<ProcessBody>()).toEqual({ processed: 1, failed: 0 });

    const [message] = await messagesTo(guestEmail);
    expect(message.subject).toBe('Recibimos tu solicitud de turno');
    expect(message.text).toContain(businessName);
    expect(message.text).toMatch(/\/public\/appointments\/[^/\s]+\/cancel/);

    const done = await jobOf(appointment.id, 'appointment_confirmation');
    expect(done).toMatchObject({ status: 'done', attempts: 1 });

    const logs = await database.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.jobId, done.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ outcome: 'sent', attempt: 1 });

    const repeated = await processJobs();
    expect(repeated.json<ProcessBody>()).toEqual({ processed: 0, failed: 0 });
    expect(await messagesTo(guestEmail)).toHaveLength(1);
  });

  it('sends the 24 h reminder exactly once when it becomes due', async () => {
    await makeDue(guestAppointmentId, 'appointment_reminder_24h');
    const result = await processJobs();

    expect(result.json<ProcessBody>()).toEqual({ processed: 1, failed: 0 });
    const reminders = await messagesTo(guestEmail);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].subject).toContain('mañana');
    expect(reminders[0].text).toContain('09:00');

    await processJobs();
    expect(await messagesTo(guestEmail)).toHaveLength(1);
  });

  it('retries a failed 2 h reminder with backoff and logs every attempt', async () => {
    const id = guestAppointmentId;

    await makeDue(id, 'appointment_reminder_2h');
    sendSpy.mockRejectedValueOnce(new Error('smtp caído'));

    const failed = await processJobs();
    expect(failed.json<ProcessBody>()).toEqual({ processed: 0, failed: 1 });
    expect(await messagesTo(guestEmail)).toHaveLength(0);

    const retrying = await jobOf(id, 'appointment_reminder_2h');
    expect(retrying).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'smtp caído',
    });
    expect(retrying.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());

    const tooSoon = await processJobs();
    expect(tooSoon.json<ProcessBody>()).toEqual({ processed: 0, failed: 0 });

    await database.db
      .update(notificationJobs)
      .set({ nextAttemptAt: OLD })
      .where(eq(notificationJobs.id, retrying.id));
    const retried = await processJobs();
    expect(retried.json<ProcessBody>()).toEqual({ processed: 1, failed: 0 });

    const done = await jobOf(id, 'appointment_reminder_2h');
    expect(done).toMatchObject({ status: 'done', attempts: 2 });

    const logs = await database.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.jobId, done.id))
      .orderBy(notificationLog.attempt);
    expect(logs.map((log) => log.outcome)).toEqual(['failed', 'sent']);
  });

  it('enqueues customer-bookings and confirms them through a signed link', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/customer/appointments',
      headers: headers(customer.accessToken),
      payload: {
        businessSlug: slug,
        serviceId: service.id,
        startsAt: slots[1],
      },
    });
    expect(response.statusCode).toBe(201);
    const appointment = response.json<AppointmentBody>();

    const jobs = await jobsFor(appointment.id);
    expect(jobs.map((job) => job.type)).toContain('appointment_confirmation');
    expect(jobs).toHaveLength(3);

    const links = app.get<SignedLinksService>(SIGNED_LINKS);
    const token = links.sign({
      appointmentId: appointment.id,
      tenantId: owner.tenant.id,
      recipient: customerEmail,
      action: 'confirm',
      expiresAt: Date.now() + 3_600_000,
    });

    const confirmed = await app.inject({
      method: 'POST',
      url: `/v1/public/appointments/${token}/confirm`,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<AppointmentBody>()).toMatchObject({
      id: appointment.id,
      status: 'confirmed',
    });

    const after = await jobsFor(appointment.id);
    expect(after.map((job) => job.type)).toContain('appointment_confirmed');

    const tampered = await app.inject({
      method: 'GET',
      url: `/v1/public/appointments/${token}x/cancel`,
    });
    expect(tampered.statusCode).toBe(401);
  });

  it('cancels pending reminders and mails both sides through a signed link', async () => {
    const appointment = await bookGuest(
      slots[2],
      'Guest Two',
      guest2Email,
      '198.51.100.22',
    );

    await makeDue(appointment.id, 'appointment_confirmation');
    await processJobs();

    const [confirmation] = await messagesTo(guest2Email);
    const match = confirmation.text.match(
      /\/public\/appointments\/([^/\s]+)\/cancel/,
    );
    expect(match).toBeTruthy();

    const cancelled = await app.inject({
      method: 'GET',
      url: `/v1/public/appointments/${match?.[1]}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<AppointmentBody>()).toMatchObject({
      id: appointment.id,
      status: 'cancelled',
    });

    const types = (await jobsFor(appointment.id)).map((job) => job.type);
    expect(types).toContain('appointment_cancelled');
    expect(types).toContain('appointment_cancelled_business');
    expect(types).not.toContain('appointment_reminder_24h');
    expect(types).not.toContain('appointment_reminder_2h');

    await makeDue(appointment.id, 'appointment_cancelled');
    await processJobs();
    expect((await messagesTo(guest2Email))[0].subject).toBe(
      'Tu turno fue cancelado',
    );

    await makeDue(appointment.id, 'appointment_cancelled_business');
    await processJobs();
    const [notice] = await messagesTo(businessEmail);
    expect(notice.subject).toBe('Cancelación de turno');
    expect(notice.text).not.toContain('/public/appointments/');
  });

  it('emits a rejection with its reason when the business changes the status', async () => {
    const appointment = await bookGuest(
      slots[3],
      'Guest Three',
      guest3Email,
      '198.51.100.23',
    );

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment.id}/status`,
      headers: headers(owner.accessToken),
      payload: { status: 'rejected', reason: 'Sin disponibilidad' },
    });
    expect(rejected.statusCode).toBe(200);

    const types = (await jobsFor(appointment.id)).map((job) => job.type);
    expect(types).toContain('appointment_rejected');
    expect(types).not.toContain('appointment_reminder_24h');
    expect(types).not.toContain('appointment_reminder_2h');

    await makeDue(appointment.id, 'appointment_rejected');
    const result = await processJobs();
    expect(result.json<ProcessBody>()).toEqual({ processed: 1, failed: 0 });

    const [message] = await messagesTo(guest3Email);
    expect(message.subject).toBe('Tu solicitud de turno fue rechazada');
    expect(message.text).toContain('Motivo: Sin disponibilidad');
  });

  it('does not enqueue duplicate jobs for the same dedupe key', async () => {
    const appointment = await bookGuest(
      slots[4],
      'Guest Four',
      `notifications-duplicate-${suffix}@opria.test`,
      '198.51.100.24',
    );

    const before = await database.db
      .select()
      .from(notificationJobs)
      .where(inArray(notificationJobs.appointmentId, [appointment.id]));
    expect(before.length).toBeGreaterThan(0);

    // A retried webhook with the same key must be a no-op.
    const outbox = app.get(NotificationsService);
    await outbox.enqueue({
      tenantId: owner.tenant.id,
      appointmentId: appointment.id,
      type: 'appointment_confirmation',
      recipient: guestEmail,
      payload: {},
      dedupeKey: before[0].dedupeKey,
    });

    const after = await jobsFor(appointment.id);
    expect(after).toHaveLength(before.length);
  });
});
