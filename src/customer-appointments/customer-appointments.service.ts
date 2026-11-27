import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  type Appointment,
  appointments,
  customers,
  type Tenant,
  tenants,
} from '../database/schema/index.js';
import { AppointmentNotificationsService } from '../notifications/appointment-notifications.service.js';
import type {
  CreateCustomerAppointmentInput,
  CustomerAppointment,
  CustomerAppointmentList,
  ListCustomerAppointmentsQuery,
} from './customer-appointments.schemas.js';

const MS_PER_HOUR = 3_600_000;
const CANCELLABLE_STATUSES = ['pending', 'confirmed'] as const;

@Injectable()
export class CustomerAppointmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentsService,
    private readonly notifications: AppointmentNotificationsService,
  ) {}

  async list(
    customerId: string,
    query: ListCustomerAppointmentsQuery,
  ): Promise<CustomerAppointmentList> {
    const where = eq(appointments.customerId, customerId);
    const [rows, totals] = await Promise.all([
      this.database.db
        .select({ appointment: appointments, tenant: tenants })
        .from(appointments)
        .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
        .where(where)
        .orderBy(asc(appointments.startsAt))
        .limit(query.limit),
      this.database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(appointments)
        .where(where),
    ]);

    return {
      items: rows.map((row) =>
        toResponse(row.appointment, row.tenant, new Date()),
      ),
      total: totals[0]?.count ?? 0,
    };
  }

  async create(
    customerId: string,
    input: CreateCustomerAppointmentInput,
  ): Promise<CustomerAppointment> {
    const [customer, tenant] = await Promise.all([
      this.database.db.query.customers.findFirst({
        where: eq(customers.id, customerId),
      }),
      this.database.db.query.tenants.findFirst({
        where: and(
          eq(tenants.slug, input.businessSlug),
          eq(tenants.status, 'active'),
        ),
      }),
    ]);

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (!tenant) {
      throw new NotFoundException('Business not found');
    }

    const appointment = await this.appointments.createPublic(
      tenant.id,
      {
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        notes: input.notes,
      },
      customer.id,
    );

    return toResponse(appointment, tenant, new Date());
  }

  async cancel(
    customerId: string,
    appointmentId: string,
  ): Promise<CustomerAppointment> {
    const row = await this.database.db
      .select({ appointment: appointments, tenant: tenants })
      .from(appointments)
      .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
      .where(
        and(
          eq(appointments.id, appointmentId),
          eq(appointments.customerId, customerId),
        ),
      )
      .then((rows) => rows[0]);

    if (!row) {
      throw new NotFoundException('Appointment not found');
    }

    if (
      !CANCELLABLE_STATUSES.includes(
        row.appointment.status as (typeof CANCELLABLE_STATUSES)[number],
      )
    ) {
      throw new ConflictException(
        `Cannot cancel an appointment in status ${row.appointment.status}`,
      );
    }

    const now = new Date();
    const deadline = new Date(
      row.appointment.startsAt.getTime() -
        row.tenant.cancellationHours * MS_PER_HOUR,
    );

    if (now > deadline) {
      throw new ConflictException(
        `Cancellations are not allowed within ${row.tenant.cancellationHours} hours of the appointment`,
      );
    }

    const [updated] = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .update(appointments)
        .set({
          status: 'cancelled',
          statusReason: 'Cancelled by customer',
          statusChangedAt: now,
        })
        .where(
          and(
            eq(appointments.id, appointmentId),
            eq(appointments.customerId, customerId),
            inArray(appointments.status, [...CANCELLABLE_STATUSES]),
          ),
        )
        .returning();

      const cancelled = rows[0];

      if (cancelled) {
        await this.notifications.statusChanged(
          cancelled,
          row.tenant,
          'cancelled',
          'Cancelled by customer',
          tx,
        );
      }

      return rows;
    });

    if (!updated) {
      throw new ConflictException('The appointment changed, try again');
    }

    return toResponse(updated, row.tenant, now);
  }
}

function toResponse(
  appointment: Appointment,
  tenant: Tenant,
  now: Date,
): CustomerAppointment {
  const deadline = new Date(
    appointment.startsAt.getTime() - tenant.cancellationHours * MS_PER_HOUR,
  );

  return {
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    serviceName: appointment.serviceName,
    staffName: appointment.staffName,
    priceCents: appointment.priceCents,
    depositType: appointment.depositType,
    depositValue: appointment.depositValue,
    notes: appointment.notes,
    createdAt: appointment.createdAt.toISOString(),
    canCancel:
      CANCELLABLE_STATUSES.includes(
        appointment.status as (typeof CANCELLABLE_STATUSES)[number],
      ) && now <= deadline,
    cancellationHours: tenant.cancellationHours,
    business: {
      name: tenant.name,
      slug: tenant.slug,
      city: tenant.city,
      address: tenant.address,
      logoUrl: tenant.logoUrl,
      timezone: tenant.timezone,
    },
  };
}
