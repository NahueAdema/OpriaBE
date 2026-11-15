import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { uniqueViolationConstraint } from '../common/database/postgres-errors.js';
import { DatabaseService } from '../database/database.service.js';
import {
  type NewTenant,
  type Tenant,
  tenants,
} from '../database/schema/index.js';
import type {
  BusinessResponse,
  UpdateBusinessInput,
} from './business.schemas.js';

@Injectable()
export class BusinessService {
  constructor(private readonly database: DatabaseService) {}

  async get(tenantId: string): Promise<BusinessResponse> {
    const tenant = await this.findTenant(tenantId);

    return this.toResponse(tenant);
  }

  async update(
    tenantId: string,
    input: UpdateBusinessInput,
  ): Promise<BusinessResponse> {
    const patch = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<NewTenant>;

    try {
      const [tenant] = await this.database.db
        .update(tenants)
        .set(patch)
        .where(eq(tenants.id, tenantId))
        .returning();

      if (!tenant) {
        throw new NotFoundException('Business not found');
      }

      return this.toResponse(tenant);
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);

      if (constraint?.includes('slug')) {
        throw new ConflictException('Tenant slug is already taken');
      }

      throw error;
    }
  }

  private async findTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.database.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant) {
      throw new NotFoundException('Business not found');
    }

    return tenant;
  }

  private toResponse(tenant: Tenant): BusinessResponse {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      timezone: tenant.timezone,
      plan: tenant.plan,
      status: tenant.status,
      logoUrl: tenant.logoUrl,
      address: tenant.address,
      city: tenant.city,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
      cancellationHours: tenant.cancellationHours,
      cancellationDepositPolicy: tenant.cancellationDepositPolicy,
      bookingMinAdvanceMinutes: tenant.bookingMinAdvanceMinutes,
      bookingMaxAdvanceDays: tenant.bookingMaxAdvanceDays,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }
}
