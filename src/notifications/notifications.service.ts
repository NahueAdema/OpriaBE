import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { Logger as PinoLogger } from 'nestjs-pino';
import { DatabaseService } from '../database/database.service.js';
import {
  type NewNotificationJob,
  notificationJobs,
  type NotificationJob,
  type NotificationJobStatus,
  type NotificationPayload,
} from '../database/schema/index.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email.provider.js';

const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 5;

export interface EnqueueNotificationInput {
  tenantId: string;
  type: string;
  recipient: string;
  payload: NotificationPayload;
  scheduledAt?: Date;
  /** Usually `${appointmentId}:${type}:${scheduledAt}`. */
  dedupeKey: string;
}

export interface ProcessBatchResult {
  processed: number;
  failed: number;
}

const subjectByType: Record<string, string> = {
  appointment_confirmation: 'Turno confirmado',
  appointment_rejected: 'Turno rechazado',
  appointment_cancelled: 'Turno cancelado',
  appointment_reminder_24h: 'Recordatorio: tu turno es mañana',
  appointment_reminder_2h: 'Recordatorio: tu turno es en 2 horas',
  payment_expired: 'Reserva cancelada por falta de pago',
};

function messageFor(job: NotificationJob) {
  const name = job.payload.customerName ?? '';
  const greeting = name ? `Hola ${name}:` : 'Hola:';
  const when = job.payload.startsAt ? ` ${job.payload.startsAt}` : '';

  return {
    to: job.recipient,
    subject: subjectByType[job.type] ?? 'Novedades sobre tu turno',
    text: `${greeting}${when}. Gestioná tu reserva desde Opria.`,
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly logger: PinoLogger,
  ) {}

  /** Inserts an outbox row; a duplicate dedupe key is a no-op. */
  async enqueue(
    input: EnqueueNotificationInput,
  ): Promise<NotificationJob | null> {
    const values: NewNotificationJob = input;
    const [created] = await this.database.db
      .insert(notificationJobs)
      .values(values)
      .onConflictDoNothing({ target: notificationJobs.dedupeKey })
      .returning();

    if (created) {
      return created;
    }

    this.logger.debug(
      { dedupeKey: input.dedupeKey },
      'notification duplicated',
    );

    return (
      (await this.database.db.query.notificationJobs.findFirst({
        where: eq(notificationJobs.dedupeKey, input.dedupeKey),
      })) ?? null
    );
  }

  /**
   * Claims due jobs with `FOR UPDATE SKIP LOCKED`, sends them and records the
   * outcome. A failed attempt stays pending until `MAX_ATTEMPTS` is reached.
   */
  async processBatch(
    limit = 20,
    now = new Date(),
  ): Promise<ProcessBatchResult> {
    const staleBefore = new Date(now.getTime() - LEASE_MINUTES * 60_000);

    const claimed = await this.database.db.transaction(async (tx) => {
      const jobs = await tx
        .select()
        .from(notificationJobs)
        .where(
          and(
            eq(notificationJobs.status, 'pending'),
            lte(notificationJobs.scheduledAt, now),
            lt(notificationJobs.attempts, MAX_ATTEMPTS),
            or(
              isNull(notificationJobs.lockedAt),
              lt(notificationJobs.lockedAt, staleBefore),
            ),
          ),
        )
        .orderBy(asc(notificationJobs.scheduledAt))
        .limit(limit)
        .for('update', { skipLocked: true });

      if (jobs.length > 0) {
        await tx
          .update(notificationJobs)
          .set({ lockedAt: now })
          .where(
            inArray(
              notificationJobs.id,
              jobs.map((job) => job.id),
            ),
          );
      }

      return jobs;
    });

    let processed = 0;
    let failed = 0;

    for (const job of claimed) {
      try {
        await this.email.send(messageFor(job));
        await this.database.db
          .update(notificationJobs)
          .set({ status: 'done', lockedAt: null, updatedAt: new Date() })
          .where(eq(notificationJobs.id, job.id));
        processed += 1;
      } catch (error) {
        const attempts = job.attempts + 1;
        const status: NotificationJobStatus =
          attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        const reason = error instanceof Error ? error.message : String(error);

        await this.database.db
          .update(notificationJobs)
          .set({
            attempts,
            status,
            lockedAt: null,
            lastError: reason.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(eq(notificationJobs.id, job.id));
        failed += 1;
      }
    }

    if (claimed.length > 0) {
      this.logger.log({
        processed,
        failed,
        msg: 'notification batch processed',
      });
    }

    return { processed, failed };
  }
}
