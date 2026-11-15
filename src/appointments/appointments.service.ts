import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  sql,
} from 'drizzle-orm';
import { localDateKey } from '../availability/availability.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { isExclusionViolation } from '../common/database/postgres-errors.js';
import { DatabaseService } from '../database/database.service.js';
import {
  type Appointment,
  appointments,
  type Service,
  services,
  type Staff,
  staff,
  tenants,
} from '../database/schema/index.js';
import type {
  AppointmentListResponse,
  AppointmentResponse,
  CreateAppointmentInput,
  ListAppointmentsQuery,
  UpdateAppointmentStatusInput,
} from './appointments.schemas.js';
import { canTransition } from './appointments.transitions.js';

const MS_PER_MINUTE = 60_000;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly availability: AvailabilityService,
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
      where: and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, id),
      ),
    });

    if (!existing) {
      throw new NotFoundException('Appointment not found');
    }

    if (!canTransition(existing.status, input.status)) {
      throw new ConflictException(
        `Cannot change an appointment from ${existing.status} to ${input.status}`,
      );
    }

    const [updated] = await this.database.db
      .update(appointments)
      .set({
        status: input.status,
        statusReason: input.reason ?? null,
        statusChangedAt: new Date(),
      })
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.id, id)))
      .returning();

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
    const [service, tenant] = await Promise.all([
      this.database.db.query.services.findFirst({
        where: and(
          eq(services.tenantId, tenantId),
          eq(services.id, input.serviceId),
        ),
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

    const startsAt = new Date(input.startsAt);
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

    const candidates = await this.database.db.query.staff.findMany({
      where: and(
        eq(staff.tenantId, tenantId),
        inArray(staff.id, slot.staffIds),
        eq(staff.active, true),
      ),
    });

    candidates.sort((left, right) => left.name.localeCompare(right.name));

    for (const member of candidates) {
      const created = await this.tryCreate(
        tenantId,
        service,
        member,
        startsAt,
        endsAt,
        input,
        customerId,
      );

      if (created) {
        return created;
      }
    }

    throw new ConflictException('That time is no longer available');
  }

  private async tryCreate(
    tenantId: string,
    service: Service,
    member: Staff,
    startsAt: Date,
    endsAt: Date,
    input: CreateAppointmentInput,
    customerId?: string,
  ): Promise<Appointment | null> {
    const bufferMs = service.bufferMinutes * MS_PER_MINUTE;

    try {
      return await this.database.db.transaction(async (tx) => {
        // Serialize bookings per staff member so the buffer check below cannot
        // race with another request for the same person.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${member.id})::bigint)`,
        );

        const conflicts = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, tenantId),
              eq(appointments.staffId, member.id),
              inArray(appointments.status, ['pending', 'confirmed']),
              lt(
                appointments.startsAt,
                new Date(endsAt.getTime() + bufferMs),
              ),
              gt(
                appointments.endsAt,
                new Date(startsAt.getTime() - bufferMs),
              ),
            ),
          )
          .limit(1);

        if (conflicts.length > 0) {
          return null;
        }

        const [created] = await tx
          .insert(appointments)
          .values({
            tenantId,
            serviceId: service.id,
            staffId: member.id,
            customerId: customerId ?? null,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            customerEmail: input.customerEmail?.toLowerCase() ?? null,
            notes: input.notes ?? null,
            startsAt,
            endsAt,
            durationMinutes: service.durationMinutes,
            bufferMinutes: service.bufferMinutes,
            serviceName: service.name,
            staffName: member.name,
            priceCents: service.priceCents,
            depositType: service.depositType,
            depositValue: service.depositValue,
            status: 'pending',
          })
          .returning();

        return created ?? null;
      });
    } catch (error) {
      if (isExclusionViolation(error)) {
        return null;
      }

      throw error;
    }
  }
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
