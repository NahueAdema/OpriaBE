import { Inject, Injectable } from '@nestjs/common';
import {
  addDaysToDateKey,
  localDateKey,
  zonedDateTimeToUtc,
} from '../availability/availability.js';
import type {
  Appointment,
  AppointmentStatus,
  NotificationPayload,
  Tenant,
} from '../database/schema/index.js';
import type { NotificationTx } from './notifications.service.js';
import { NotificationsService } from './notifications.service.js';
import { SIGNED_LINKS, SignedLinksService } from './signed-links.js';

const REMINDER_TYPES = [
  'appointment_reminder_24h',
  'appointment_reminder_2h',
] as const;

const MINUTES_PER_DAY = 1_440;
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function pad(value: number): string {
  return `${value}`.padStart(2, '0');
}

function localParts(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const values: Record<string, number> = {};

  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

/**
 * "24 h before" and "2 h before" are wall-clock offsets in the tenant
 * timezone, not fixed durations: across a DST change the reminder may be 23
 * or 25 real hours before the appointment. Invalid local times fall back to
 * the absolute offset.
 */
export function reminderAt(
  startsAt: Date,
  timeZone: string,
  minutesBefore: number,
): Date {
  const parts = localParts(startsAt, timeZone);
  const dateKey = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const shifted = parts.hour * 60 + parts.minute - minutesBefore;
  const dayShift = Math.floor(shifted / MINUTES_PER_DAY);
  const minuteOfDay = shifted - dayShift * MINUTES_PER_DAY;
  const reminderDate = addDaysToDateKey(dateKey, dayShift);
  const time = `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;

  return (
    zonedDateTimeToUtc(reminderDate, time, timeZone) ??
    new Date(startsAt.getTime() - minutesBefore * 60_000)
  );
}

/**
 * Maps appointment events to outbox rows. It never talks to an email provider
 * directly: delivery, retries and rendering live behind `NotificationsService`.
 */
@Injectable()
export class AppointmentNotificationsService {
  constructor(
    private readonly outbox: NotificationsService,
    @Inject(SIGNED_LINKS) private readonly links: SignedLinksService,
  ) {}

  /**
   * Called inside the same transaction that inserts the appointment.
   * Panel bookings created directly as `confirmed` skip the "request received"
   * mail: they get the confirmation mail plus the same reminders instead.
   */
  async created(
    appointment: Appointment,
    tenant: Tenant,
    tx?: NotificationTx,
    skipRequest = false,
  ): Promise<void> {
    const recipient = appointment.customerEmail?.toLowerCase();

    if (!recipient) {
      return;
    }

    const payload = this.payload(appointment, tenant);
    payload.actionUrl = this.actionUrl(
      appointment,
      tenant,
      recipient,
      'cancel',
    );

    if (!skipRequest) {
      await this.outbox.enqueue(
        {
          tenantId: tenant.id,
          appointmentId: appointment.id,
          type: 'appointment_confirmation',
          recipient,
          payload,
          dedupeKey: `${appointment.id}:appointment_confirmation:${appointment.createdAt.toISOString()}`,
        },
        tx,
      );
    }

    await this.scheduleReminders(appointment, tenant, recipient, payload, tx);
  }

  /**
   * Rescheduling keeps the same appointment id but moves the slot: drop the
   * reminders for the old time and enqueue fresh ones for the new one.
   */
  async rescheduled(
    appointment: Appointment,
    tenant: Tenant,
    tx?: NotificationTx,
  ): Promise<void> {
    await this.outbox.cancelPendingForAppointment(
      appointment.id,
      REMINDER_TYPES,
      tx,
    );

    const stamp = (appointment.statusChangedAt ?? new Date()).toISOString();
    const payload = this.payload(appointment, tenant);
    const recipient = appointment.customerEmail?.toLowerCase();

    if (recipient) {
      payload.actionUrl = this.actionUrl(
        appointment,
        tenant,
        recipient,
        'cancel',
      );

      await this.enqueueStatus(
        appointment,
        tenant,
        'appointment_rescheduled',
        recipient,
        payload,
        stamp,
        tx,
      );

      await this.scheduleReminders(appointment, tenant, recipient, payload, tx);
    }

    // RF-NOT-03: the business also hears about the new time.
    if (tenant.contactEmail) {
      await this.enqueueStatus(
        appointment,
        tenant,
        'appointment_rescheduled_business',
        tenant.contactEmail.toLowerCase(),
        payload,
        stamp,
        tx,
      );
    }
  }

  /** Called after a status transition (panel, customer or signed link). */
  async statusChanged(
    appointment: Appointment,
    tenant: Tenant,
    status: AppointmentStatus,
    reason: string | null,
    tx?: NotificationTx,
  ): Promise<void> {
    const recipient = appointment.customerEmail?.toLowerCase();
    const stamp = (appointment.statusChangedAt ?? new Date()).toISOString();
    const payload = this.payload(appointment, tenant, reason);

    if (status === 'cancelled' || status === 'rejected') {
      await this.outbox.cancelPendingForAppointment(
        appointment.id,
        REMINDER_TYPES,
        tx,
      );
    }

    if (recipient && status === 'confirmed') {
      payload.actionUrl = this.actionUrl(
        appointment,
        tenant,
        recipient,
        'cancel',
      );

      await this.enqueueStatus(
        appointment,
        tenant,
        'appointment_confirmed',
        recipient,
        payload,
        stamp,
        tx,
      );
    }

    if (recipient && status === 'cancelled') {
      await this.enqueueStatus(
        appointment,
        tenant,
        'appointment_cancelled',
        recipient,
        payload,
        stamp,
        tx,
      );
    }

    if (recipient && status === 'rejected') {
      await this.enqueueStatus(
        appointment,
        tenant,
        'appointment_rejected',
        recipient,
        payload,
        stamp,
        tx,
      );
    }

    // RF-NOT-03: both sides hear about a cancellation.
    if (status === 'cancelled' && tenant.contactEmail) {
      await this.enqueueStatus(
        appointment,
        tenant,
        'appointment_cancelled_business',
        tenant.contactEmail.toLowerCase(),
        payload,
        stamp,
        tx,
      );
    }
  }

  private async scheduleReminders(
    appointment: Appointment,
    tenant: Tenant,
    recipient: string,
    payload: NotificationPayload,
    tx?: NotificationTx,
  ): Promise<void> {
    const now = new Date();
    const timeZone = tenant.timezone || DEFAULT_TIMEZONE;

    for (const [type, minutesBefore] of [
      ['appointment_reminder_24h', 1_440],
      ['appointment_reminder_2h', 120],
    ] as const) {
      const scheduledAt = reminderAt(
        appointment.startsAt,
        timeZone,
        minutesBefore,
      );

      // A same-day booking can already be inside the 24 h/2 h window.
      if (scheduledAt.getTime() <= now.getTime()) {
        continue;
      }

      await this.outbox.enqueue(
        {
          tenantId: tenant.id,
          appointmentId: appointment.id,
          type,
          recipient,
          payload: {
            ...payload,
            actionUrl: this.actionUrl(appointment, tenant, recipient, 'cancel'),
          },
          scheduledAt,
          dedupeKey: `${appointment.id}:${type}:${scheduledAt.toISOString()}`,
        },
        tx,
      );
    }
  }

  private async enqueueStatus(
    appointment: Appointment,
    tenant: Tenant,
    type: string,
    recipient: string,
    payload: NotificationPayload,
    stamp: string,
    tx?: NotificationTx,
  ): Promise<void> {
    await this.outbox.enqueue(
      {
        tenantId: tenant.id,
        appointmentId: appointment.id,
        type,
        recipient,
        payload,
        dedupeKey: `${appointment.id}:${type}:${stamp}`,
      },
      tx,
    );
  }

  private actionUrl(
    appointment: Appointment,
    tenant: Tenant,
    recipient: string,
    action: 'confirm' | 'cancel',
  ): string {
    return this.links.actionUrl({
      appointmentId: appointment.id,
      tenantId: tenant.id,
      recipient,
      action,
    });
  }

  private payload(
    appointment: Appointment,
    tenant: Tenant,
    reason?: string | null,
  ): NotificationPayload {
    return {
      appointmentId: appointment.id,
      customerName: appointment.customerName,
      businessName: tenant.name,
      serviceName: appointment.serviceName,
      staffName: appointment.staffName,
      timezone: tenant.timezone || DEFAULT_TIMEZONE,
      startsAt: appointment.startsAt.toISOString(),
      reason: reason ?? appointment.statusReason ?? undefined,
    };
  }
}

/** Exported for tests that assert reminders in a tenant's wall clock. */
export function localDateFor(instant: Date, timeZone: string): string {
  return localDateKey(instant, timeZone);
}
