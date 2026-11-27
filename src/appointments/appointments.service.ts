import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { localDateKey } from '../availability/availability.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { isExclusionViolation } from '../common/database/postgres-errors.js';
import {
  type Database,
  DatabaseService,
} from '../database/database.service.js';
import {
  type Appointment,
  type AppointmentRequest,
  appointmentRequests,
  appointments,
  type CustomerProfile,
  customerProfiles,
  type Service,
  services,
  type Staff,
  staff,
  type Tenant,
  tenants,
} from '../database/schema/index.js';
import { AppointmentNotificationsService } from '../notifications/appointment-notifications.service.js';
import type { NotificationTx } from '../notifications/notifications.service.js';
import type {
  AppointmentListResponse,
  AppointmentResponse,
  CreateAppointmentInput,
  CreatePanelAppointmentInput,
  ListAppointmentsQuery,
  RescheduleAppointmentInput,
  UpdateAppointmentStatusInput,
} from './appointments.schemas.js';
import { canTransition } from './appointments.transitions.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const BLOCKING_STATUSES = ['pending', 'confirmed'] as const;

/** Both the root database and a Drizzle transaction satisfy this surface. */
type AppointmentTx = Parameters<Parameters<Database['transaction']>[0]>[0];
type AppointmentDb = Database | AppointmentTx;

interface InsertAppointmentInput {
  tenantId: string;
  tenant: Tenant;
  service: Service;
  member: Staff;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
  customerId?: string;
  status: 'pending' | 'confirmed';
  consent: boolean;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly notifications: AppointmentNotificationsService,
  ) {}

  async list(
    tenantId: string,
    query: ListAppointmentsQuery,
  ): Promise<AppointmentListResponse> {
    const conditions = [eq(appointments.tenantId, tenantId)];

    if (query.from) {
      conditions.push(gte(appointments.startsAt, new Date(query.from)));
    }

    if (query.to) {
      conditions.push(lt(appointments.startsAt, new Date(query.to)));
    }

    if (query.status) {
      conditions.push(eq(appointments.status, query.status));
    }

    if (query.staffId) {
      conditions.push(eq(appointments.staffId, query.staffId));
    }

    if (query.serviceId) {
      conditions.push(eq(appointments.serviceId, query.serviceId));
    }

    const where = and(...conditions);
    const [rows, totals] = await Promise.all([
      this.database.db
        .select()
        .from(appointments)
        .where(where)
        .orderBy(asc(appointments.startsAt))
        .limit(query.limit),
      this.database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(appointments)
        .where(where),
    ]);

    return {
      items: rows.map(toResponse),
      total: totals[0]?.count ?? 0,
    };
  }

  async updateStatus(
    tenantId: string,
    id: string,
    input: UpdateAppointmentStatusInput,
  ): Promise<AppointmentResponse> {
    const existing = await this.database.db.query.appointments.findFirst({
      where: and(eq(appointments.tenantId, tenantId), eq(appointments.id, id)),
    });

    if (!existing) {
      throw new NotFoundException('Appointment not found');
    }

    if (!canTransition(existing.status, input.status)) {
      throw new ConflictException(
        `Cannot change an appointment from ${existing.status} to ${input.status}`,
      );
    }

    const tenant = await this.database.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant) {
      throw new NotFoundException('Business not found');
    }

    const updated = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(appointments)
        .set({
          status: input.status,
          statusReason: input.reason ?? null,
          statusChangedAt: new Date(),
        })
        .where(
          and(eq(appointments.tenantId, tenantId), eq(appointments.id, id)),
        )
        .returning();

      if (!row) {
        return null;
      }

      await this.notifications.statusChanged(
        row,
        tenant,
        input.status,
        input.reason ?? null,
        tx,
      );

      return row;
    });

    if (!updated) {
      throw new NotFoundException('Appointment not found');
    }

    return toResponse(updated);
  }

  /**
   * Creates a pending appointment from the public booking flow.
   *
   * The requested slot is recomputed against the real availability, so a
   * client cannot send an arbitrary time. Each candidate staff member is tried
   * inside a transaction that locks the staff row and re-checks the buffer;
   * the Postgres exclusion constraint is the final guard for races.
   */
  async createPublic(
    tenantId: string,
    input: CreateAppointmentInput,
    customerId?: string,
  ): Promise<Appointment> {
    const { service, tenant, startsAt, endsAt, candidates } =
      await this.prepareBooking(tenantId, input.serviceId, input.startsAt);

    for (const member of candidates) {
      const created = await this.tryCreate({
        tenantId,
        tenant,
        service,
        member,
        startsAt,
        endsAt,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        notes: input.notes,
        customerId,
        status: 'pending',
        consent: false,
      });

      if (created) {
        return created;
      }
    }

    throw new ConflictException('That time is no longer available');
  }

  /**
   * Manual booking from the panel. The `Idempotency-Key` header makes a retried
   * submit return the original appointment instead of booking twice; the
   * fingerprint rejects reusing one key for a different payload.
   */
  async createPanel(
    tenantId: string,
    idempotencyKey: string,
    input: CreatePanelAppointmentInput,
  ): Promise<AppointmentResponse> {
    const fingerprint = requestFingerprint(input);
    const existing = await this.database.db.query.appointmentRequests.findFirst(
      {
        where: and(
          eq(appointmentRequests.tenantId, tenantId),
          eq(appointmentRequests.idempotencyKey, idempotencyKey),
        ),
      },
    );

    if (existing) {
      return this.replay(existing, fingerprint);
    }

    const { service, tenant, startsAt, endsAt, candidates } =
      await this.prepareBooking(
        tenantId,
        input.serviceId,
        input.startsAt,
        input.staffId,
      );

    try {
      return await this.database.db.transaction(async (tx) => {
        const [reserved] = await tx
          .insert(appointmentRequests)
          .values({ tenantId, idempotencyKey, requestFingerprint: fingerprint })
          .onConflictDoNothing({
            target: [
              appointmentRequests.tenantId,
              appointmentRequests.idempotencyKey,
            ],
          })
          .returning();

        if (!reserved) {
          // A concurrent request with the same key won the insert; replay it.
          const concurrent = await tx.query.appointmentRequests.findFirst({
            where: and(
              eq(appointmentRequests.tenantId, tenantId),
              eq(appointmentRequests.idempotencyKey, idempotencyKey),
            ),
          });

          if (!concurrent) {
            throw new ConflictException('Could not reserve the request key');
          }

          return this.replay(concurrent, fingerprint, tx);
        }

        let created: Appointment | null = null;

        for (const member of candidates) {
          created = await this.insertForStaff(tx, tx, {
            tenantId,
            tenant,
            service,
            member,
            startsAt,
            endsAt,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            customerEmail: input.customerEmail,
            notes: input.notes,
            customerId: input.customerId,
            status: input.status,
            consent: input.consent ?? false,
          });

          if (created) {
            break;
          }
        }

        if (!created) {
          throw new ConflictException('That time is no longer available');
        }

        await tx
          .update(appointmentRequests)
          .set({ appointmentId: created.id })
          .where(eq(appointmentRequests.id, reserved.id));

        return toResponse(created);
      });
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new ConflictException('That time is no longer available');
      }

      throw error;
    }
  }

  /** Moves an existing appointment, enforcing the business notice policy. */
  async reschedule(
    tenantId: string,
    id: string,
    input: RescheduleAppointmentInput,
  ): Promise<AppointmentResponse> {
    const row = await this.database.db
      .select({ appointment: appointments, tenant: tenants })
      .from(appointments)
      .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)))
      .then((rows) => rows[0]);

    if (!row) {
      throw new NotFoundException('Appointment not found');
    }

    const { appointment, tenant } = row;

    if (
      !(BLOCKING_STATUSES as readonly string[]).includes(appointment.status)
    ) {
      throw new ConflictException(
        `Cannot reschedule an appointment in status ${appointment.status}`,
      );
    }

    const now = new Date();
    const deadline = new Date(
      appointment.startsAt.getTime() - tenant.cancellationHours * MS_PER_HOUR,
    );

    if (now > deadline) {
      throw new ConflictException(
        `Rescheduling is not allowed within ${tenant.cancellationHours} hours of the appointment`,
      );
    }

    const startsAt = new Date(input.startsAt);

    if (startsAt.getTime() <= now.getTime()) {
      throw new ConflictException('The new time must be in the future');
    }

    if (startsAt.getTime() === appointment.startsAt.getTime()) {
      return toResponse(appointment);
    }

    const endsAt = new Date(
      startsAt.getTime() + appointment.durationMinutes * MS_PER_MINUTE,
    );
    const date = localDateKey(startsAt, tenant.timezone);
    const availability = await this.availability.get(tenantId, {
      serviceId: appointment.serviceId,
      date,
    });
    const slot = availability.slots.find(
      (candidate) => candidate.startsAt === startsAt.toISOString(),
    );

    if (!slot || !slot.staffIds.includes(appointment.staffId)) {
      throw new ConflictException('That time is no longer available');
    }

    const bufferMs = appointment.bufferMinutes * MS_PER_MINUTE;

    try {
      const updated = await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${appointment.staffId})::bigint)`,
        );

        const conflicts = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, tenantId),
              eq(appointments.staffId, appointment.staffId),
              ne(appointments.id, appointment.id),
              inArray(appointments.status, [...BLOCKING_STATUSES]),
              lt(appointments.startsAt, new Date(endsAt.getTime() + bufferMs)),
              gt(appointments.endsAt, new Date(startsAt.getTime() - bufferMs)),
            ),
          )
          .limit(1);

        if (conflicts.length > 0) {
          throw new ConflictException('That time is no longer available');
        }

        const [changed] = await tx
          .update(appointments)
          .set({
            startsAt,
            endsAt,
            statusReason: input.reason ?? null,
            statusChangedAt: now,
          })
          .where(
            and(
              eq(appointments.id, appointment.id),
              eq(appointments.tenantId, tenantId),
              inArray(appointments.status, [...BLOCKING_STATUSES]),
            ),
          )
          .returning();

        if (!changed) {
          throw new ConflictException('The appointment changed, try again');
        }

        await this.notifications.rescheduled(changed, tenant, tx);

        return changed;
      });

      return toResponse(updated);
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new ConflictException('That time is no longer available');
      }

      throw error;
    }
  }

  /** Recomputes the slot and resolves the staff who can attend it. */
  private async prepareBooking(
    tenantId: string,
    serviceId: string,
    startsAtInput: string,
    preferredStaffId?: string,
  ): Promise<{
    service: Service;
    tenant: Tenant;
    startsAt: Date;
    endsAt: Date;
    candidates: Staff[];
  }> {
    const [service, tenant] = await Promise.all([
      this.database.db.query.services.findFirst({
        where: and(eq(services.tenantId, tenantId), eq(services.id, serviceId)),
      }),
      this.database.db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      }),
    ]);

    if (!tenant) {
      throw new NotFoundException('Business not found');
    }

    if (!service || !service.active) {
      throw new NotFoundException('Service not found');
    }

    const startsAt = new Date(startsAtInput);
    const endsAt = new Date(
      startsAt.getTime() + service.durationMinutes * MS_PER_MINUTE,
    );
    const date = localDateKey(startsAt, tenant.timezone);
    const availability = await this.availability.get(tenantId, {
      serviceId: service.id,
      date,
    });
    const slot = availability.slots.find(
      (candidate) => candidate.startsAt === startsAt.toISOString(),
    );

    if (!slot) {
      throw new ConflictException('That time is no longer available');
    }

    let staffIds = slot.staffIds;

    if (preferredStaffId) {
      if (!staffIds.includes(preferredStaffId)) {
        throw new ConflictException(
          'The selected professional is not available at that time',
        );
      }

      staffIds = [preferredStaffId];
    }

    const candidates =
      staffIds.length === 0
        ? []
        : await this.database.db.query.staff.findMany({
            where: and(
              eq(staff.tenantId, tenantId),
              inArray(staff.id, staffIds),
              eq(staff.active, true),
            ),
          });

    candidates.sort((left, right) => left.name.localeCompare(right.name));

    if (preferredStaffId && candidates.length === 0) {
      throw new NotFoundException('Professional not found');
    }

    return { service, tenant, startsAt, endsAt, candidates };
  }

  private async tryCreate(
    value: InsertAppointmentInput,
  ): Promise<Appointment | null> {
    try {
      return await this.database.db.transaction((tx) =>
        this.insertForStaff(tx, tx, value),
      );
    } catch (error) {
      if (isExclusionViolation(error)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Locks the staff member, re-checks the buffer and inserts in one
   * transaction. The exclusion constraint is still the final race guard.
   */
  private async insertForStaff(
    db: AppointmentDb,
    tx: NotificationTx | undefined,
    value: InsertAppointmentInput,
  ): Promise<Appointment | null> {
    const bufferMs = value.service.bufferMinutes * MS_PER_MINUTE;

    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext(${value.member.id})::bigint)`,
    );

    const conflicts = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, value.tenantId),
          eq(appointments.staffId, value.member.id),
          inArray(appointments.status, [...BLOCKING_STATUSES]),
          lt(
            appointments.startsAt,
            new Date(value.endsAt.getTime() + bufferMs),
          ),
          gt(
            appointments.endsAt,
            new Date(value.startsAt.getTime() - bufferMs),
          ),
        ),
      )
      .limit(1);

    if (conflicts.length > 0) {
      return null;
    }

    const statusChangedAt = value.status === 'confirmed' ? new Date() : null;
    const [created] = await db
      .insert(appointments)
      .values({
        tenantId: value.tenantId,
        serviceId: value.service.id,
        staffId: value.member.id,
        customerId: value.customerId ?? null,
        customerName: value.customerName,
        customerPhone: value.customerPhone,
        customerEmail: value.customerEmail?.toLowerCase() ?? null,
        notes: value.notes ?? null,
        startsAt: value.startsAt,
        endsAt: value.endsAt,
        durationMinutes: value.service.durationMinutes,
        bufferMinutes: value.service.bufferMinutes,
        serviceName: value.service.name,
        staffName: value.member.name,
        priceCents: value.service.priceCents,
        depositType: value.service.depositType,
        depositValue: value.service.depositValue,
        status: value.status,
        statusChangedAt,
      })
      .returning();

    if (!created) {
      return null;
    }

    // Same transaction as the insert: no email can be promised for a
    // booking that was rolled back.
    await this.notifications.created(
      created,
      value.tenant,
      tx,
      value.status === 'confirmed',
    );

    if (value.status === 'confirmed') {
      await this.notifications.statusChanged(
        { ...created, status: 'confirmed' },
        value.tenant,
        'confirmed',
        null,
        tx,
      );
    }

    if (value.consent) {
      await this.recordConsent(db, value);
    }

    return created;
  }

  /** RF-CLI-03: consent captured while creating a manual booking. */
  private async recordConsent(
    db: AppointmentDb,
    value: InsertAppointmentInput,
  ): Promise<CustomerProfile | undefined> {
    const consentAt = new Date();
    const email = value.customerEmail?.toLowerCase() ?? null;
    const set: Partial<typeof customerProfiles.$inferInsert> = {
      name: value.customerName,
      email,
      consentAt,
      consentSource: 'booking',
      updatedAt: consentAt,
    };

    if (value.customerId) {
      set.customerId = value.customerId;
    }

    const [profile] = await db
      .insert(customerProfiles)
      .values({
        tenantId: value.tenantId,
        customerId: value.customerId ?? null,
        name: value.customerName,
        phone: value.customerPhone,
        email,
        consentAt,
        consentSource: 'booking',
      })
      .onConflictDoUpdate({
        target: [customerProfiles.tenantId, customerProfiles.phone],
        set,
      })
      .returning();

    return profile;
  }

  private async replay(
    record: AppointmentRequest,
    fingerprint: string,
    db: AppointmentDb = this.database.db,
  ): Promise<AppointmentResponse> {
    if (record.requestFingerprint !== fingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request',
      );
    }

    if (!record.appointmentId) {
      throw new ConflictException('The original request is still processing');
    }

    const appointment = await db.query.appointments.findFirst({
      where: and(
        eq(appointments.id, record.appointmentId),
        eq(appointments.tenantId, record.tenantId),
      ),
    });

    if (!appointment) {
      throw new ConflictException(
        'The original appointment is no longer available',
      );
    }

    return toResponse(appointment);
  }
}

function requestFingerprint(input: CreatePanelAppointmentInput): string {
  const canonical = {
    serviceId: input.serviceId,
    startsAt: new Date(input.startsAt).toISOString(),
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    customerEmail: input.customerEmail?.trim().toLowerCase() ?? null,
    notes: input.notes?.trim() ?? null,
    staffId: input.staffId ?? null,
    customerId: input.customerId ?? null,
    status: input.status,
    consent: input.consent ?? false,
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function toResponse(row: Appointment): AppointmentResponse {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    notes: row.notes,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    staffId: row.staffId,
    staffName: row.staffName,
    durationMinutes: row.durationMinutes,
    bufferMinutes: row.bufferMinutes,
    priceCents: row.priceCents,
    depositType: row.depositType,
    depositValue: row.depositValue,
    statusReason: row.statusReason,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
