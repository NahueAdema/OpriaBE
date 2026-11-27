import { z } from 'zod';
import type { NotificationJob } from '../database/schema/index.js';
import type { NotificationMessage } from './email.provider.js';

export const notificationTypes = [
  'appointment_confirmation',
  'appointment_confirmed',
  'appointment_rejected',
  'appointment_cancelled',
  'appointment_cancelled_business',
  'appointment_rescheduled',
  'appointment_rescheduled_business',
  'appointment_reminder_24h',
  'appointment_reminder_2h',
  'payment_expired',
] as const;

export const notificationTypeSchema = z.enum(notificationTypes);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

const subjectByType: Record<NotificationType, string> = {
  appointment_confirmation: 'Recibimos tu solicitud de turno',
  appointment_confirmed: 'Tu turno fue confirmado',
  appointment_rejected: 'Tu solicitud de turno fue rechazada',
  appointment_cancelled: 'Tu turno fue cancelado',
  appointment_cancelled_business: 'Cancelación de turno',
  appointment_rescheduled: 'Se reprogramó tu turno',
  appointment_rescheduled_business: 'Turno reprogramado',
  appointment_reminder_24h: 'Recordatorio: tu turno es mañana',
  appointment_reminder_2h: 'Recordatorio: tu turno es en 2 horas',
  payment_expired: 'Reserva cancelada por falta de pago',
};

/** es-AR copy for every transactional email. Plain text keeps the provider seam simple. */
export function subjectFor(type: string): string {
  const parsed = notificationTypeSchema.safeParse(type);

  return parsed.success
    ? subjectByType[parsed.data]
    : 'Novedades sobre tu turno';
}

function formatWhen(job: NotificationJob): string {
  const value = job.payload.startsAt;

  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: job.payload.timezone ?? DEFAULT_TIMEZONE,
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return value;
  }
}

function line(label: string, value: string | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

function body(job: NotificationJob): string {
  const { payload } = job;
  const name = payload.customerName?.trim() || '';
  const greeting = name ? `Hola ${name}:` : 'Hola:';
  const when = formatWhen(job);
  const business = payload.businessName;
  const service = payload.serviceName;
  const staff = payload.staffName;
  const reason = payload.reason?.trim();
  const link = payload.actionUrl;

  const details = [
    line('Negocio', business),
    line('Servicio', service),
    line('Profesional', staff),
    line('Fecha y hora', when),
    line('Motivo', reason),
  ]
    .filter((value): value is string => value !== null)
    .join('\n');

  const parsedType = notificationTypeSchema.safeParse(job.type);
  let intro: string;

  switch (parsedType.success ? parsedType.data : undefined) {
    case 'appointment_confirmation':
      intro = `Recibimos tu solicitud de turno${business ? ` en ${business}` : ''}. Te avisaremos en cuanto sea confirmado.`;
      break;
    case 'appointment_confirmed':
      intro = `Tu turno${business ? ` en ${business}` : ''} fue confirmado.`;
      break;
    case 'appointment_rejected':
      intro = `Lamentablemente no pudimos confirmar tu solicitud${business ? ` en ${business}` : ''}.`;
      break;
    case 'appointment_cancelled':
      intro = `Tu turno${business ? ` en ${business}` : ''} fue cancelado.`;
      break;
    case 'appointment_cancelled_business':
      intro = `Se canceló un turno${name ? ` de ${name}` : ''}. Revisá la agenda para ver el detalle.`;
      break;
    case 'appointment_rescheduled':
      intro = `Tu turno${business ? ` en ${business}` : ''} se reprogramó. Tené en cuenta la nueva fecha y hora.`;
      break;
    case 'appointment_rescheduled_business':
      intro = `Se reprogramó un turno${name ? ` de ${name}` : ''}. Revisá la agenda para ver el detalle.`;
      break;
    case 'appointment_reminder_24h':
      intro = `Te recordamos que tu turno${business ? ` en ${business}` : ''} es mañana.`;
      break;
    case 'appointment_reminder_2h':
      intro = `Te recordamos que tu turno${business ? ` en ${business}` : ''} es en aproximadamente 2 horas.`;
      break;
    case 'payment_expired':
      intro = `Tu reserva${business ? ` en ${business}` : ''} fue cancelada porque no se completó el pago dentro del plazo.`;
      break;
    default:
      intro = `Tenemos novedades sobre tu turno${business ? ` en ${business}` : ''}.`;
  }

  const parts = [greeting, intro];

  if (details) {
    parts.push(details);
  }

  if (link && job.type !== 'appointment_cancelled_business') {
    parts.push(`Podés gestionar tu reserva desde este enlace: ${link}`);
  }

  parts.push('Gracias por elegirnos.');

  return parts.join('\n\n');
}

export function renderNotification(job: NotificationJob): NotificationMessage {
  return {
    to: job.recipient,
    subject: subjectFor(job.type),
    text: body(job),
  };
}
