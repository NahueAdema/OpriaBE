import { Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from 'drizzle-orm';
import { AvailabilityService } from '../availability/availability.service.js';
import type { CalendarQuery, CalendarResponse } from '../availability/availability.schemas.js';
import { DatabaseService } from '../database/database.service.js';
import {
  services,
  type Tenant,
  tenants,
} from '../database/schema/index.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import type { CreateAppointmentInput } from '../appointments/appointments.schemas.js';
import type {
  PublicAppointment,
  PublicAvailability,
  PublicAvailabilityQuery,
  PublicBusiness,
  PublicBusinessFilters,
  PublicBusinessList,
  SearchBusinessesQuery,
} from './public-booking.schemas.js';

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
  ) {}

  async search(query: SearchBusinessesQuery): Promise<PublicBusinessList> {
    const conditions = [eq(tenants.status, 'active')];

    if (query.q) {
      const term = `%${escapeLike(query.q)}%`;
      const nameMatch = or(ilike(tenants.name, term), ilike(tenants.slug, term));

      if (nameMatch) {
        conditions.push(nameMatch);
      }
    }

    if (query.city) {
      conditions.push(ilike(tenants.city, query.city));
    }

    if (query.service) {
      conditions.push(
        inArray(
          tenants.id,
          this.database.db
            .select({ id: services.tenantId })
            .from(services)
            .where(
              and(
                eq(services.active, true),
                ilike(services.name, query.service),
              ),
            ),
        ),
      );
    }

    const rows = await this.database.db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        address: tenants.address,
        city: tenants.city,
        logoUrl: tenants.logoUrl,
      })
      .from(tenants)
      .where(and(...conditions))
      .orderBy(asc(tenants.name))
      .limit(50);

    if (rows.length === 0) {
      return { items: [] };
    }

    const counts = await this.database.db
      .select({
        tenantId: services.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(services)
      .where(
        and(
          inArray(
            services.tenantId,
            rows.map((row) => row.id),
          ),
          eq(services.active, true),
        ),
      )
      .groupBy(services.tenantId);
    const countByTenant = new Map(
      counts.map((row) => [row.tenantId, row.count]),
    );

    return {
      items: rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        address: row.address,
        city: row.city,
        logoUrl: row.logoUrl,
        serviceCount: countByTenant.get(row.id) ?? 0,
      })),
    };
  }

  async getFilters(): Promise<PublicBusinessFilters> {
    const [cityRows, serviceRows] = await Promise.all([
      this.database.db
        .selectDistinct({ city: tenants.city })
        .from(tenants)
        .where(and(eq(tenants.status, 'active'), isNotNull(tenants.city)))
        .orderBy(asc(tenants.city)),
      this.database.db
        .selectDistinct({ name: services.name })
        .from(services)
        .innerJoin(tenants, eq(services.tenantId, tenants.id))
        .where(and(eq(tenants.status, 'active'), eq(services.active, true)))
        .orderBy(asc(services.name)),
    ]);

    return {
      cities: cityRows
        .map((row) => row.city)
        .filter((city): city is string => Boolean(city)),
      services: serviceRows.map((row) => row.name),
    };
  }

  async getBusiness(slug: string): Promise<PublicBusiness> {
    const tenant = await this.requireTenant(slug);
    const rows = await this.database.db.query.services.findMany({
      where: and(
        eq(services.tenantId, tenant.id),
        eq(services.active, true),
      ),
      with: { staffServices: { with: { staff: true } } },
      orderBy: (table, { asc: orderAsc }) => [orderAsc(table.name)],
    });
    const bookable = rows.filter((service) =>
      service.staffServices.some((link) => link.staff.active),
    );

    return {
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      logoUrl: tenant.logoUrl,
      address: tenant.address,
      city: tenant.city,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
      cancellationHours: tenant.cancellationHours,
      cancellationDepositPolicy: tenant.cancellationDepositPolicy,
      bookingMinAdvanceMinutes: tenant.bookingMinAdvanceMinutes,
      bookingMaxAdvanceDays: tenant.bookingMaxAdvanceDays,
      services: bookable.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
        priceCents: service.priceCents,
        depositType: service.depositType,
        depositValue: service.depositValue,
      })),
    };
  }

  async getAvailability(
    slug: string,
    query: PublicAvailabilityQuery,
  ): Promise<PublicAvailability> {
    const tenant = await this.requireTenant(slug);
    const response = await this.availability.get(tenant.id, query);

    return {
      ...response,
      slots: response.slots.map((slot) => ({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      })),
    };
  }

  async getCalendar(
    slug: string,
    query: CalendarQuery,
  ): Promise<CalendarResponse> {
    const tenant = await this.requireTenant(slug);

    return this.availability.getCalendar(tenant.id, query);
  }

  async createAppointment(
    slug: string,
    input: CreateAppointmentInput,
  ): Promise<PublicAppointment> {
    const tenant = await this.requireTenant(slug);
    const appointment = await this.appointments.createPublic(tenant.id, input);

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
      customerName: appointment.customerName,
      business: {
        name: tenant.name,
        slug: tenant.slug,
        timezone: tenant.timezone,
      },
    };
  }

  private async requireTenant(slug: string): Promise<Tenant> {
    const tenant = await this.database.db.query.tenants.findFirst({
      where: and(eq(tenants.slug, slug), eq(tenants.status, 'active')),
    });

    if (!tenant) {
      throw new NotFoundException('Business not found');
    }

    return tenant;
  }
}

/** Prevent users from injecting LIKE wildcards into a search term. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '');
}
