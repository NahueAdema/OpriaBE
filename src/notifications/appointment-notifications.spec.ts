import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Appointment,
  NotificationPayload,
  Tenant,
} from '../database/schema/index.js';
import {
  AppointmentNotificationsService,
  reminderAt,
} from './appointment-notifications.service.js';
import type {
  EnqueueNotificationInput,
  NotificationsService,
} from './notifications.service.js';
import type { SignedLinksService } from './signed-links.js';

const tenant = {
  id: 'e47c5d0d-6f3d-4bac-8e1e-2f2a3b4c5d6e',
  name: 'Estudio Opria',
  timezone: 'America/Argentina/Buenos_Aires',
  contactEmail: 'negocio@opria.test',
} as unknown as Tenant;

const startsAt = new Date('2026-12-01T13:00:00.000Z');

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'd36b4c9c-5e2c-4a9b-9d0d-1e1f2a3b4c5d',
    tenantId: tenant.id,
    customerName: 'Ana',
    customerEmail: 'ana@example.com',
    serviceName: 'Corte',
    staffName: 'Sol',
    status: 'pending',
    statusReason: null,
    startsAt,
    createdAt: new Date('2026-11-20T10:00:00.000Z'),
    statusChangedAt: new Date('2026-11-25T10:00:00.000Z'),
    ...overrides,
  } as unknown as Appointment;
}

function harness() {
  const enqueue = vi.fn().mockResolvedValue(null);
  const cancel = vi.fn().mockResolvedValue(0);
  const actionUrl = vi.fn().mockReturnValue('https://api.test/cancel');
  const outbox = { enqueue, cancelPendingForAppointment: cancel };
  const links = { actionUrl };

  return {
    enqueue,
    cancel,
    service: new AppointmentNotificationsService(
      outbox as unknown as NotificationsService,
      links as unknown as SignedLinksService,
    ),
    inputs: () =>
      enqueue.mock.calls.map((call) => call[0] as EnqueueNotificationInput),
  };
}

describe('reminderAt', () => {
  it('uses wall-clock time in the tenant timezone, not a fixed 24 h offset', () => {
    // Spring-forward in America/New_York: the previous local morning is 23 real
    // hours before the appointment, not 24.
    const starts = new Date('2026-03-08T14:00:00.000Z');

    expect(reminderAt(starts, 'America/New_York', 1_440).toISOString()).toBe(
      '2026-03-07T15:00:00.000Z',
    );
    expect(reminderAt(starts, 'America/New_York', 120).toISOString()).toBe(
      '2026-03-08T12:00:00.000Z',
    );
  });

  it('keeps the tenant calendar date across a UTC day boundary', () => {
    const starts = new Date('2026-12-01T01:00:00.000Z');

    expect(
      reminderAt(starts, 'America/Argentina/Buenos_Aires', 1_440).toISOString(),
    ).toBe('2026-11-30T01:00:00.000Z');
  });
});

describe('AppointmentNotificationsService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('enqueues a confirmation and both reminders in the tenant timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
    const h = harness();

    await h.service.created(appointment(), tenant);

    const jobs = h.inputs();
    expect(jobs.map((job) => job.type)).toEqual([
      'appointment_confirmation',
      'appointment_reminder_24h',
      'appointment_reminder_2h',
    ]);
    expect(jobs[0].dedupeKey).toContain('appointment_confirmation');
    expect(jobs[1].scheduledAt?.toISOString()).toBe('2026-11-30T13:00:00.000Z');
    expect(jobs[1].dedupeKey).toBe(
      `${appointment().id}:appointment_reminder_24h:2026-11-30T13:00:00.000Z`,
    );
    expect(jobs[2].scheduledAt?.toISOString()).toBe('2026-12-01T11:00:00.000Z');
    expect((jobs[1].payload as NotificationPayload).timezone).toBe(
      tenant.timezone,
    );
  });

  it('does not enqueue anything without a customer email', async () => {
    const h = harness();

    await h.service.created(appointment({ customerEmail: null }), tenant);

    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('cancels pending reminders and notifies both sides on cancellation', async () => {
    const h = harness();

    await h.service.statusChanged(
      appointment({ status: 'cancelled', statusReason: 'Pedido del cliente' }),
      tenant,
      'cancelled',
      'Pedido del cliente',
    );

    expect(h.cancel).toHaveBeenCalledWith(
      appointment().id,
      ['appointment_reminder_24h', 'appointment_reminder_2h'],
      undefined,
    );
    expect(h.inputs().map((job) => job.type)).toEqual([
      'appointment_cancelled',
      'appointment_cancelled_business',
    ]);
    expect(h.inputs()[1].recipient).toBe('negocio@opria.test');
  });

  it('notifies the customer when the business confirms the request', async () => {
    const h = harness();

    await h.service.statusChanged(
      appointment({ status: 'confirmed' }),
      tenant,
      'confirmed',
      null,
    );

    expect(h.cancel).not.toHaveBeenCalled();
    expect(h.inputs().map((job) => job.type)).toEqual([
      'appointment_confirmed',
    ]);
  });
});
