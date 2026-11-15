import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  appointments,
  type Service,
  services,
  staff,
  type Tenant,
  tenants,
  timeBlocks,
  workingHours,
} from '../database/schema/index.js';
import {
  addDaysToDateKey,
  computeAvailability,
  type Interval,
  type WorkingWindow,
  weekdayFromDateKey,
  zonedDateTimeToUtc,
} from './availability.js';
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  CalendarQuery,
  CalendarResponse,
} from './availability.schemas.js';

const MS_PER_DAY = 86_400_000;

interface AvailabilityOptions {
  durationMinutes: number;
  bufferMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
}

/**
 * Working hours, time blocks and appointments preloaded for a date range.
 * Loading them once keeps the month calendar from issuing queries per day.
 */
interface StaffContext {
  hoursByStaff: Map<string, WorkingWindow[]>;
  blocksByStaff: Map<string, Interval[]>;
  busyByStaff: Map<string, Interval[]>;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly database: DatabaseService) {}

  async get(
    tenantId: string,
    query: AvailabilityQuery,
  ): Promise<AvailabilityResponse> {
    const [service, tenant] = await this.loadServiceAndTenant(
      tenantId,
      query.serviceId,
    );
    const eligible = await this.findEligibleStaff(
      tenantId,
      service.id,
      query.staffId,
    );
    const context = await this.loadContext(
      tenantId,
      eligible.map((member) => member.id),
      query.date,
      query.date,
      tenant.timezone,
    );
    const slots = this.computeForDate(
      query.date,
      tenant.timezone,
      this.optionsFor(service, tenant),
      eligible,
      context,
      new Date(),
    );

    return {
      date: query.date,
      timezone: tenant.timezone,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
      slots,
    };
  }

  /**
   * Tells the public calendar which days have at least one free slot. Days
   * outside the working schedule, the booking window or fully booked days
   * come back as `available: false`.
   */
  async getCalendar(
    tenantId: string,
    query: CalendarQuery,
  ): Promise<CalendarResponse> {
    const [service, tenant] = await this.loadServiceAndTenant(
      tenantId,
      query.serviceId,
    );
    const eligible = await this.findEligibleStaff(tenantId, service.id);
    const context = await this.loadContext(
      tenantId,
      eligible.map((member) => member.id),
      query.from,
      query.to,
      tenant.timezone,
    );
    const options = this.optionsFor(service, tenant);
    const now = new Date();
    const days: CalendarResponse['days'] = [];

    for (
      let date = query.from;
      date <= query.to;
      date = addDaysToDateKey(date, 1)
    ) {
      const slots = this.computeForDate(
        date,
        tenant.timezone,
        options,
        eligible,
        context,
        now,
      );

      days.push({
        date,
        available: slots.length > 0,
        slots: slots.length,
      });
    }

    return {
      timezone: tenant.timezone,
      serviceId: service.id,
      from: query.from,
      to: query.to,
      days,
    };
  }

  private async loadServiceAndTenant(
    tenantId: string,
    serviceId: string,
  ): Promise<[Service, Tenant]> {
    const [service, tenant] = await Promise.all([
      this.database.db.query.services.findFirst({
        where: and(
          eq(services.tenantId, tenantId),
          eq(services.id, serviceId),
        ),
      }),
      this.database.db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      }),
    ]);

    if (!service || !service.active) {
      throw new NotFoundException('Service not found');
    }

    if (!tenant) {
      throw new NotFoundException('Business not found');
    }

    return [service, tenant];
  }

  private optionsFor(
    service: Service,
    tenant: Tenant,
  ): AvailabilityOptions {
    return {
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
      minAdvanceMinutes: tenant.bookingMinAdvanceMinutes,
      maxAdvanceDays: tenant.bookingMaxAdvanceDays,
    };
  }

  private async findEligibleStaff(
    tenantId: string,
    serviceId: string,
    staffId?: string,
  ): Promise<Array<{ id: string }>> {
    const rows = await this.database.db.query.staff.findMany({
      where: and(
        eq(staff.tenantId, tenantId),
        eq(staff.active, true),
        staffId === undefined ? undefined : eq(staff.id, staffId),
      ),
      with: { staffServices: true },
    });

    if (staffId !== undefined) {
      const member = rows[0];

      if (!member) {
        throw new NotFoundException('Staff member not found');
      }

      if (!member.staffServices.some((link) => link.serviceId === serviceId)) {
        throw new BadRequestException(
          'Staff member is not assigned to this service',
        );
      }

      return [{ id: member.id }];
    }

    return rows
      .filter((member) =>
        member.staffServices.some((link) => link.serviceId === serviceId),
      )
      .map((member) => ({ id: member.id }));
  }

  private async loadContext(
    tenantId: string,
    staffIds: string[],
    from: string,
    to: string,
    timezone: string,
  ): Promise<StaffContext> {
    const hoursByStaff = new Map<string, WorkingWindow[]>();
    const blocksByStaff = new Map<string, Interval[]>();
    const busyByStaff = new Map<string, Interval[]>();

    if (staffIds.length === 0) {
      return { hoursByStaff, blocksByStaff, busyByStaff };
    }

    const range = dateRangeWithMargin(from, to, timezone);
    const [hourRows, blockRows, appointmentRows] = await Promise.all([
      this.database.db.query.workingHours.findMany({
        where: and(
          eq(workingHours.tenantId, tenantId),
          inArray(workingHours.staffId, staffIds),
        ),
      }),
      this.database.db.query.timeBlocks.findMany({
        where: and(
          eq(timeBlocks.tenantId, tenantId),
          inArray(timeBlocks.staffId, staffIds),
          lt(timeBlocks.startsAt, range.endsAt),
          gt(timeBlocks.endsAt, range.startsAt),
        ),
      }),
      this.database.db.query.appointments.findMany({
        where: and(
          eq(appointments.tenantId, tenantId),
          inArray(appointments.staffId, staffIds),
          inArray(appointments.status, ['pending', 'confirmed']),
          lt(appointments.startsAt, range.endsAt),
          gt(appointments.endsAt, range.startsAt),
        ),
      }),
    ]);

    for (const row of hourRows) {
      const entries = hoursByStaff.get(row.staffId) ?? [];
      entries.push({
        weekday: row.weekday,
        startTime: toHHMM(row.startTime),
        endTime: toHHMM(row.endTime),
      });
      hoursByStaff.set(row.staffId, entries);
    }

    for (const row of blockRows) {
      const entries = blocksByStaff.get(row.staffId) ?? [];
      entries.push({ startsAt: row.startsAt, endsAt: row.endsAt });
      blocksByStaff.set(row.staffId, entries);
    }

    for (const row of appointmentRows) {
      const entries = busyByStaff.get(row.staffId) ?? [];
      entries.push({ startsAt: row.startsAt, endsAt: row.endsAt });
      busyByStaff.set(row.staffId, entries);
    }

    return { hoursByStaff, blocksByStaff, busyByStaff };
  }

  private computeForDate(
    date: string,
    timezone: string,
    options: AvailabilityOptions,
    eligible: Array<{ id: string }>,
    context: StaffContext,
    now: Date,
  ): AvailabilityResponse['slots'] {
    if (eligible.length === 0) {
      return [];
    }

    const weekday = weekdayFromDateKey(date);
    const merged = new Map<
      string,
      { startsAt: string; endsAt: string; staffIds: Set<string> }
    >();

    for (const member of eligible) {
      const slots = computeAvailability({
        date,
        timezone,
        durationMinutes: options.durationMinutes,
        bufferMinutes: options.bufferMinutes,
        workingHours: (context.hoursByStaff.get(member.id) ?? []).filter(
          (window) => window.weekday === weekday,
        ),
        timeBlocks: context.blocksByStaff.get(member.id) ?? [],
        busy: context.busyByStaff.get(member.id) ?? [],
        now,
        minAdvanceMinutes: options.minAdvanceMinutes,
        maxAdvanceDays: options.maxAdvanceDays,
      });

      for (const slot of slots) {
        const existing = merged.get(slot.startsAt);

        if (existing) {
          existing.staffIds.add(member.id);
        } else {
          merged.set(slot.startsAt, {
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            staffIds: new Set([member.id]),
          });
        }
      }
    }

    return [...merged.values()]
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
      .map((slot) => ({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        staffIds: [...slot.staffIds].sort(),
      }));
  }
}

/**
 * The UTC range covered by a local calendar date, widened by one day on each
 * side so DST transitions and midnight-less timezones never clip a time block.
 */
function dayRangeWithMargin(
  date: string,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  const nextDate = addDaysToDateKey(date, 1);
  const startsAt =
    zonedDateTimeToUtc(date, '00:00', timezone) ??
    new Date(`${date}T00:00:00.000Z`);
  const endsAt =
    zonedDateTimeToUtc(nextDate, '00:00', timezone) ??
    new Date(`${nextDate}T00:00:00.000Z`);

  return {
    startsAt: new Date(startsAt.getTime() - MS_PER_DAY),
    endsAt: new Date(endsAt.getTime() + MS_PER_DAY),
  };
}

function dateRangeWithMargin(
  from: string,
  to: string,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: dayRangeWithMargin(from, timezone).startsAt,
    endsAt: dayRangeWithMargin(to, timezone).endsAt,
  };
}

function toHHMM(value: string): string {
  return value.slice(0, 5);
}
