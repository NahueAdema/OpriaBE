import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  type NewService,
  type Service,
  services,
} from '../database/schema/index.js';
import { depositValidationMessage } from './deposit.js';
import type {
  CreateServiceInput,
  ListServicesQuery,
  ServiceResponse,
  UpdateServiceInput,
} from './services.schemas.js';

@Injectable()
export class ServicesService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    tenantId: string,
    query: ListServicesQuery,
  ): Promise<ServiceResponse[]> {
    const rows = await this.database.db.query.services.findMany({
      where: and(
        eq(services.tenantId, tenantId),
        query.active === undefined
          ? undefined
          : eq(services.active, query.active),
      ),
      orderBy: (table, { asc }) => [asc(table.name)],
    });

    return rows.map((row) => this.toResponse(row));
  }

  async get(tenantId: string, id: string): Promise<ServiceResponse> {
    return this.toResponse(await this.findEntity(tenantId, id));
  }

  async create(
    tenantId: string,
    input: CreateServiceInput,
  ): Promise<ServiceResponse> {
    const [created] = await this.database.db
      .insert(services)
      .values({ tenantId, ...input })
      .returning();

    return this.toResponse(created);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateServiceInput,
  ): Promise<ServiceResponse> {
    const existing = await this.findEntity(tenantId, id);
    const message = depositValidationMessage({
      priceCents: input.priceCents ?? existing.priceCents,
      depositType: input.depositType ?? existing.depositType,
      depositValue: input.depositValue ?? existing.depositValue,
    });

    if (message) {
      throw new BadRequestException(message);
    }

    const patch = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<NewService>;

    const [updated] = await this.database.db
      .update(services)
      .set(patch)
      .where(and(eq(services.tenantId, tenantId), eq(services.id, id)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Service not found');
    }

    return this.toResponse(updated);
  }

  /** Soft delete: keeps history for existing appointments (RF-SRV-01). */
  async deactivate(tenantId: string, id: string): Promise<void> {
    const [updated] = await this.database.db
      .update(services)
      .set({ active: false })
      .where(and(eq(services.tenantId, tenantId), eq(services.id, id)))
      .returning({ id: services.id });

    if (!updated) {
      throw new NotFoundException('Service not found');
    }
  }

  private async findEntity(tenantId: string, id: string): Promise<Service> {
    const service = await this.database.db.query.services.findFirst({
      where: and(eq(services.tenantId, tenantId), eq(services.id, id)),
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  private toResponse(service: Service): ServiceResponse {
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
      priceCents: service.priceCents,
      depositType: service.depositType,
      depositValue: service.depositValue,
      active: service.active,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
    };
  }
}
