import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { uniqueViolationConstraint } from '../common/database/postgres-errors.js';
import { DatabaseService } from '../database/database.service.js';
import {
  memberships,
  type NewStaff,
  type Service,
  type Staff,
  type StaffService as StaffServiceLink,
  services,
  staff,
  staffServices,
  type TimeBlock,
  timeBlocks,
  workingHours,
} from '../database/schema/index.js';
import type {
  CreateStaffInput,
  CreateTimeBlockInput,
  ListStaffQuery,
  ListTimeBlocksQuery,
  ReplaceWorkingHoursInput,
  SetStaffServicesInput,
  StaffResponse,
  TimeBlockResponse,
  UpdateStaffInput,
  WorkingHoursResponse,
} from './staff.schemas.js';

type StaffRow = Staff & {
  staffServices: Array<StaffServiceLink & { service: Service }>;
};

@Injectable()
export class StaffService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    tenantId: string,
    query: ListStaffQuery,
  ): Promise<StaffResponse[]> {
    const rows = await this.database.db.query.staff.findMany({
      where: and(
        eq(staff.tenantId, tenantId),
        query.active === undefined ? undefined : eq(staff.active, query.active),
      ),
      with: { staffServices: { with: { service: true } } },
      orderBy: (table, { asc }) => [asc(table.name)],
    });

    return rows.map((row) => this.toResponse(row));
  }

  async get(tenantId: string, id: string): Promise<StaffResponse> {
    return this.toResponse(await this.findEntity(tenantId, id));
  }

  async create(
    tenantId: string,
    input: CreateStaffInput,
  ): Promise<StaffResponse> {
    if (input.userId) {
      await this.assertUserIsMember(tenantId, input.userId);
    }

    try {
      const [created] = await this.database.db
        .insert(staff)
        .values({ tenantId, ...input })
        .returning({ id: staff.id });

      return this.get(tenantId, created.id);
    } catch (error) {
      this.rethrowUniqueViolation(error);
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateStaffInput,
  ): Promise<StaffResponse> {
    await this.findEntity(tenantId, id);

    if (input.userId) {
      await this.assertUserIsMember(tenantId, input.userId);
    }

    const patch = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<NewStaff>;

    try {
      const [updated] = await this.database.db
        .update(staff)
        .set(patch)
        .where(and(eq(staff.tenantId, tenantId), eq(staff.id, id)))
        .returning({ id: staff.id });

      if (!updated) {
        throw new NotFoundException('Staff member not found');
      }

      return this.get(tenantId, id);
    } catch (error) {
      this.rethrowUniqueViolation(error);
      throw error;
    }
  }

  async deactivate(tenantId: string, id: string): Promise<void> {
    const [updated] = await this.database.db
      .update(staff)
      .set({ active: false })
      .where(and(eq(staff.tenantId, tenantId), eq(staff.id, id)))
      .returning({ id: staff.id });

    if (!updated) {
      throw new NotFoundException('Staff member not found');
    }
  }

  /** Replaces the full set of services a staff member performs. */
  async setServices(
    tenantId: string,
    staffId: string,
    input: SetStaffServicesInput,
  ): Promise<StaffResponse> {
    await this.findEntity(tenantId, staffId);

    const serviceIds = [...new Set(input.serviceIds)];

    if (serviceIds.length > 0) {
      const found = await this.database.db
        .select({ id: services.id })
        .from(services)
        .where(
          and(
            eq(services.tenantId, tenantId),
            inArray(services.id, serviceIds),
          ),
        );
      const foundIds = new Set(found.map((row) => row.id));
      const missing = serviceIds.filter((id) => !foundIds.has(id));

      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown service ids: ${missing.join(', ')}`,
        );
      }
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .delete(staffServices)
        .where(
          and(
            eq(staffServices.tenantId, tenantId),
            eq(staffServices.staffId, staffId),
          ),
        );

      if (serviceIds.length > 0) {
        await tx.insert(staffServices).values(
          serviceIds.map((serviceId) => ({
            tenantId,
            staffId,
            serviceId,
          })),
        );
      }
    });

    return this.get(tenantId, staffId);
  }

  async getWorkingHours(
    tenantId: string,
    staffId: string,
  ): Promise<WorkingHoursResponse> {
    await this.findEntity(tenantId, staffId);

    const rows = await this.database.db.query.workingHours.findMany({
      where: and(
        eq(workingHours.tenantId, tenantId),
        eq(workingHours.staffId, staffId),
      ),
      orderBy: (table, { asc }) => [
        asc(table.weekday),
        asc(table.startTime),
      ],
    });

    return {
      hours: rows.map((row) => ({
        id: row.id,
        weekday: row.weekday,
        startTime: toHHMM(row.startTime),
        endTime: toHHMM(row.endTime),
      })),
    };
  }

  /** Replaces the whole weekly schedule in one transaction. */
  async replaceWorkingHours(
    tenantId: string,
    staffId: string,
    input: ReplaceWorkingHoursInput,
  ): Promise<WorkingHoursResponse> {
    await this.findEntity(tenantId, staffId);

    await this.database.db.transaction(async (tx) => {
      await tx
        .delete(workingHours)
        .where(
          and(
            eq(workingHours.tenantId, tenantId),
            eq(workingHours.staffId, staffId),
          ),
        );

      if (input.hours.length > 0) {
        await tx.insert(workingHours).values(
          input.hours.map((entry) => ({
            tenantId,
            staffId,
            weekday: entry.weekday,
            startTime: toPostgresTime(entry.startTime),
            endTime: toPostgresTime(entry.endTime),
          })),
        );
      }
    });

    return this.getWorkingHours(tenantId, staffId);
  }

  async listTimeBlocks(
    tenantId: string,
    staffId: string,
    query: ListTimeBlocksQuery,
  ): Promise<TimeBlockResponse[]> {
    await this.findEntity(tenantId, staffId);

    const conditions = [
      eq(timeBlocks.tenantId, tenantId),
      eq(timeBlocks.staffId, staffId),
    ];

    if (query.to) {
      conditions.push(lt(timeBlocks.startsAt, new Date(query.to)));
    }

    if (query.from) {
      conditions.push(gt(timeBlocks.endsAt, new Date(query.from)));
    }

    const rows = await this.database.db.query.timeBlocks.findMany({
      where: and(...conditions),
      orderBy: (table, { asc }) => [asc(table.startsAt)],
    });

    return rows.map((row) => this.toTimeBlockResponse(row));
  }

  async createTimeBlock(
    tenantId: string,
    staffId: string,
    input: CreateTimeBlockInput,
  ): Promise<TimeBlockResponse> {
    await this.findEntity(tenantId, staffId);

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const overlapping = await this.database.db.query.timeBlocks.findFirst({
      where: and(
        eq(timeBlocks.tenantId, tenantId),
        eq(timeBlocks.staffId, staffId),
        lt(timeBlocks.startsAt, endsAt),
        gt(timeBlocks.endsAt, startsAt),
      ),
    });

    if (overlapping) {
      throw new ConflictException('Time block overlaps an existing block');
    }

    const [created] = await this.database.db
      .insert(timeBlocks)
      .values({
        tenantId,
        staffId,
        startsAt,
        endsAt,
        reason: input.reason ?? null,
      })
      .returning();

    return this.toTimeBlockResponse(created);
  }

  async deleteTimeBlock(
    tenantId: string,
    staffId: string,
    blockId: string,
  ): Promise<void> {
    const [deleted] = await this.database.db
      .delete(timeBlocks)
      .where(
        and(
          eq(timeBlocks.tenantId, tenantId),
          eq(timeBlocks.staffId, staffId),
          eq(timeBlocks.id, blockId),
        ),
      )
      .returning({ id: timeBlocks.id });

    if (!deleted) {
      throw new NotFoundException('Time block not found');
    }
  }

  private async findEntity(tenantId: string, id: string): Promise<StaffRow> {
    const row = await this.database.db.query.staff.findFirst({
      where: and(eq(staff.tenantId, tenantId), eq(staff.id, id)),
      with: { staffServices: { with: { service: true } } },
    });

    if (!row) {
      throw new NotFoundException('Staff member not found');
    }

    return row;
  }

  private async assertUserIsMember(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.database.db.query.memberships.findFirst({
      where: and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, userId),
      ),
    });

    if (!membership) {
      throw new BadRequestException('User is not a member of this tenant');
    }
  }

  private rethrowUniqueViolation(error: unknown): void {
    const constraint = uniqueViolationConstraint(error);

    if (constraint?.includes('staff_tenant_user_unique')) {
      throw new ConflictException(
        'User is already linked to a staff member',
      );
    }
  }

  private toResponse(row: StaffRow): StaffResponse {
    return {
      id: row.id,
      name: row.name,
      userId: row.userId,
      active: row.active,
      services: row.staffServices.map((entry) => ({
        id: entry.service.id,
        name: entry.service.name,
        active: entry.service.active,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toTimeBlockResponse(block: TimeBlock): TimeBlockResponse {
    return {
      id: block.id,
      startsAt: block.startsAt.toISOString(),
      endsAt: block.endsAt.toISOString(),
      reason: block.reason,
      createdAt: block.createdAt.toISOString(),
      updatedAt: block.updatedAt.toISOString(),
    };
  }
}

function toHHMM(value: string): string {
  return value.slice(0, 5);
}

function toPostgresTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}
