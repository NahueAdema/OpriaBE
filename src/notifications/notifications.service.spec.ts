import { Logger as PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../database/database.service.js';
import { notificationJobs } from '../database/schema/index.js';
import type { NotificationJob } from '../database/schema/index.js';
import type { EmailProvider } from './email.provider.js';
import { NotificationsService } from './notifications.service.js';

function makeJob(overrides: Partial<NotificationJob> = {}): NotificationJob {
  const now = new Date();

  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    appointmentId: 'appointment-1',
    type: 'appointment_confirmation',
    recipient: 'cliente@example.com',
    payload: { customerName: 'Ana', startsAt: now.toISOString() },
    scheduledAt: now,
    status: 'pending',
    attempts: 0,
    dedupeKey: 'appointment-1:appointment_confirmation',
    lockedAt: null,
    nextAttemptAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createHarness(jobs: NotificationJob[], send = vi.fn()) {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const logValues = vi.fn().mockResolvedValue(undefined);
  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue(jobs),
            }),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set }),
    insert: vi.fn().mockReturnValue({ values: logValues }),
  };
  const insertReturning = vi.fn().mockResolvedValue([]);
  const findFirst = vi.fn().mockResolvedValue(null);
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi
        .fn()
        .mockReturnValue({ returning: insertReturning }),
    }),
  });
  const deleteWhere = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{ id: 'job-1' }]),
  });
  const database = {
    db: {
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
      update: vi.fn().mockReturnValue({ set }),
      insert,
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      query: { notificationJobs: { findFirst } },
    },
  } as unknown as DatabaseService;
  const email = { send } as unknown as EmailProvider;
  const logger = { log: vi.fn(), debug: vi.fn() } as unknown as PinoLogger;

  return {
    service: new NotificationsService(database, email, logger),
    insert,
    insertReturning,
    findFirst,
    set,
    send,
    tx,
    logValues,
    deleteWhere,
  };
}

describe('NotificationsService', () => {
  const input = {
    tenantId: 'tenant-1',
    appointmentId: 'appointment-1',
    type: 'appointment_confirmation',
    recipient: 'cliente@example.com',
    payload: { appointmentId: 'appointment-1' },
    dedupeKey: 'appointment-1:appointment_confirmation',
  };

  it('enqueues a job with its dedupe key', async () => {
    const job = makeJob();
    const harness = createHarness([]);
    harness.insertReturning.mockResolvedValueOnce([job]);

    const result = await harness.service.enqueue(input);

    expect(harness.insert).toHaveBeenCalledWith(notificationJobs);
    expect(result).toEqual(job);
  });

  it('returns the existing job when the dedupe key is repeated', async () => {
    const existing = makeJob();
    const harness = createHarness([]);
    harness.findFirst.mockResolvedValueOnce(existing);

    const result = await harness.service.enqueue(input);

    expect(result).toEqual(existing);
  });

  it('sends due jobs, marks them as done and logs the attempt', async () => {
    const job = makeJob();
    const harness = createHarness([job]);
    harness.send.mockResolvedValue(undefined);

    const result = await harness.service.processBatch(5);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(harness.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: job.recipient }),
    );
    expect(harness.set).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 1,
        status: 'done',
        lockedAt: null,
        nextAttemptAt: null,
      }),
    );
    expect(harness.logValues).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'sent', attempt: 1 }),
    );
  });

  it('retries a failed send with backoff and records the reason', async () => {
    const now = new Date('2026-11-26T12:00:00.000Z');
    const job = makeJob();
    const harness = createHarness([job]);
    harness.send.mockRejectedValue(new Error('proveedor caído'));

    const result = await harness.service.processBatch(5, now);

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(harness.set).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 1,
        status: 'pending',
        lastError: 'proveedor caído',
        lockedAt: null,
        nextAttemptAt: new Date('2026-11-26T12:01:00.000Z'),
      }),
    );
    expect(harness.logValues).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', error: 'proveedor caído' }),
    );
  });

  it('doubles the backoff on later attempts', async () => {
    const now = new Date('2026-11-26T12:00:00.000Z');
    const harness = createHarness([makeJob({ attempts: 2 })]);
    harness.send.mockRejectedValue(new Error('proveedor caído'));

    await harness.service.processBatch(5, now);

    expect(harness.set).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 3,
        nextAttemptAt: new Date('2026-11-26T12:04:00.000Z'),
      }),
    );
  });

  it('marks a job as failed after the last attempt without a next retry', async () => {
    const job = makeJob({ attempts: 4 });
    const harness = createHarness([job]);
    harness.send.mockRejectedValue(new Error('proveedor caído'));

    await harness.service.processBatch(5);

    expect(harness.set).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 5,
        status: 'failed',
        nextAttemptAt: null,
      }),
    );
  });

  it('cancels pending reminders for an appointment', async () => {
    const harness = createHarness([]);

    const cancelled = await harness.service.cancelPendingForAppointment(
      'appointment-1',
      ['appointment_reminder_24h', 'appointment_reminder_2h'],
    );

    expect(cancelled).toBe(1);
    expect(harness.deleteWhere).toHaveBeenCalledOnce();
  });
});
