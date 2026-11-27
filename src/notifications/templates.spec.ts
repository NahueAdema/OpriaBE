import { describe, expect, it } from 'vitest';
import type { NotificationJob } from '../database/schema/index.js';
import { renderNotification, subjectFor } from './templates.js';

function job(overrides: Partial<NotificationJob> = {}): NotificationJob {
  const now = new Date('2026-11-26T12:00:00.000Z');

  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    appointmentId: 'appointment-1',
    type: 'appointment_confirmation',
    recipient: 'ana@example.com',
    payload: {
      customerName: 'Ana',
      businessName: 'Estudio Opria',
      serviceName: 'Corte',
      staffName: 'Sol',
      timezone: 'America/Argentina/Buenos_Aires',
      startsAt: '2026-12-01T13:00:00.000Z',
      actionUrl:
        'https://opriabe.onrender.com/v1/public/appointments/abc/cancel',
    },
    scheduledAt: now,
    status: 'pending',
    attempts: 0,
    dedupeKey: 'key',
    lockedAt: null,
    nextAttemptAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('es-AR notification templates', () => {
  it('uses a Spanish subject for every known type', () => {
    expect(subjectFor('appointment_confirmation')).toBe(
      'Recibimos tu solicitud de turno',
    );
    expect(subjectFor('appointment_reminder_24h')).toContain('Recordatorio');
    expect(subjectFor('unknown_type')).toBe('Novedades sobre tu turno');
  });

  it('renders the booking confirmation with tenant timezone and signed link', () => {
    const message = renderNotification(job());

    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe('Recibimos tu solicitud de turno');
    expect(message.text).toContain('Hola Ana:');
    expect(message.text).toContain('Estudio Opria');
    expect(message.text).toContain('Corte');
    expect(message.text).toContain('1 de diciembre de 2026');
    expect(message.text).toContain('10:00');
    expect(message.text).toContain('/abc/cancel');
  });

  it('includes the reason on a rejection and omits links on business notices', () => {
    const rejected = renderNotification(
      job({
        type: 'appointment_rejected',
        payload: {
          customerName: 'Ana',
          reason: 'Sin disponibilidad',
          startsAt: '2026-12-01T13:00:00.000Z',
          actionUrl: 'https://example.test/cancel',
        },
      }),
    );
    expect(rejected.subject).toBe('Tu solicitud de turno fue rechazada');
    expect(rejected.text).toContain('Motivo: Sin disponibilidad');

    const business = renderNotification(
      job({
        type: 'appointment_cancelled_business',
        recipient: 'negocio@example.com',
      }),
    );
    expect(business.subject).toBe('Cancelación de turno');
    expect(business.text).not.toContain('/abc/cancel');
  });
});
