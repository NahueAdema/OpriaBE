import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { Logger as PinoLogger } from 'nestjs-pino';
import {
  type Database,
  DatabaseService,
} from '../database/database.service.js';
import {
  type NewNotificationJob,
  notificationJobs,
  notificationLog,
  type NotificationJob,
  type NotificationJobStatus,
  type NotificationPayload,
} from '../database/schema/index.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email.provider.js';
import { renderNotification } from './templates.js';

/** Both the root database and a Drizzle transaction satisfy this surface. */
export type NotificationTx = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type NotificationDb = Database | NotificationTx;

const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 5;
const BACKOFF_BASE_MINUTES = 1;
const BACKOFF_MAX_MINUTES = 60;

export interface EnqueueNotificationInput {
  tenantId: string;
  /** Set for appointment emails so reminders can be cancelled in one query. */
  appointmentId?: string;
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

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Inserts an outbox row; a duplicate dedupe key is a no-op. Pass the open
   * transaction when the event must be atomic with the appointment write.
   */
  async enqueue(
    input: EnqueueNotificationInput,
    tx?: NotificationTx,
  ): Promise<NotificationJob | null> {
    const db: NotificationDb = tx ?? this.database.db;
    const values: NewNotificationJob = input;
    const [created] = await db
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
      (await db.query.notificationJobs.findFirst({
        where: eq(notificationJobs.dedupeKey, input.dedupeKey),
      })) ?? null
    );
  }

  /** Drops scheduled jobs that must no longer be delivered (e.g. reminders). */
  async cancelPendingForAppointment(
    appointmentId: string,
    types: readonly string[],
    tx?: NotificationTx,
  ): Promise<number> {
    const db: NotificationDb = tx ?? this.database.db;
    const cancelled = await db
      .delete(notificationJobs)
      .where(
        and(
          eq(notificationJobs.appointmentId, appointmentId),
          eq(notificationJobs.status, 'pending'),
          inArray(notificationJobs.type, [...types]),
        ),
      )
      .returning({ id: notificationJobs.id });

    return cancelled.length;
  }

  /**
   * Claims due jobs with `FOR UPDATE SKIP LOCKED`, sends them and records the
   * outcome. Failed attempts are retried with exponential backoff up to
   * `MAX_ATTEMPTS`; every attempt is written to `notification_log`.
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
              isNull(notificationJobs.nextAttemptAt),
              lte(notificationJobs.nextAttemptAt, now),
            ),
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
      const attempt = job.attempts + 1;

      try {
        await this.email.send(renderNotification(job));
        await this.record(job, attempt, 'sent', now);
        processed += 1;
      } catch (error) {
        const status: NotificationJobStatus =
          attempt >= MAX_ATTEMPTS ? 'failed' : 'pending';
        const reason = error instanceof Error ? error.message : String(error);

        await this.record(job, attempt, 'failed', now, reason, status);
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

  private async record(
    job: NotificationJob,
    attempt: number,
    outcome: 'sent' | 'failed',
    now: Date,
    error?: string,
    status: NotificationJobStatus = 'done',
  ): Promise<void> {
    const nextAttemptAt =
      outcome === 'failed' && status === 'pending'
        ? new Date(now.getTime() + this.backoffMs(attempt))
        : null;

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(notificationJobs)
        .set({
          attempts: attempt,
          status,
          lockedAt: null,
          nextAttemptAt,
          ...(error ? { lastError: error.slice(0, 500) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(notificationJobs.id, job.id));

      await tx.insert(notificationLog).values({
        tenantId: job.tenantId,
        jobId: job.id,
        type: job.type,
        recipient: job.recipient,
        outcome,
        attempt,
        ...(error ? { error: error.slice(0, 500) } : {}),
      });
    });
  }

  /** 1, 2, 4, 8, 16 minutes: bounded so jobs cannot disappear for hours. */
  private backoffMs(attempt: number): number {
    const minutes = Math.min(
      BACKOFF_BASE_MINUTES * 2 ** Math.max(0, attempt - 1),
      BACKOFF_MAX_MINUTES,
    );

    return minutes * 60_000;
  }
}
