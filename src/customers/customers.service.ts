import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  type Appointment,
  appointments,
  customerProfiles,
} from '../database/schema/index.js';
import { customerCsv } from './csv.js';
import type {
  CustomerDetail,
  CustomerHistoryEntry,
  CustomerListItem,
  CustomerListQuery,
  CustomerListResponse,
  UpdateCustomerInput,
} from './customers.schemas.js';

@Injectable()
export class CustomersService {
  constructor(private readonly database: DatabaseService) {}

  /** Customers are derived from appointments so guests appear too. */
  async list(
    tenantId: string,
    query: CustomerListQuery,
    overrideLimit?: number,
  ): Promise<CustomerListResponse> {
    const where = this.filter(tenantId, query.q);
    const latest = this.database.db
      .selectDistinctOn([appointments.customerPhone], {
        phone: appointments.customerPhone,
        name: appointments.customerName,
        email: appointments.customerEmail,
        customerId: appointments.customerId,
        lastAppointmentAt: appointments.startsAt,
      })
      .from(appointments)
      .where(where)
      .orderBy(appointments.customerPhone, desc(appointments.startsAt))
      .as('latest');

    const [rows, totals, counts] = await Promise.all([
      this.database.db
        .select({
          phone: latest.phone,
          name: latest.name,
          email: latest.email,
          customerId: latest.customerId,
          lastAppointmentAt: latest.lastAppointmentAt,
          profileId: customerProfiles.id,
          notes: customerProfiles.notes,
          consentAt: customerProfiles.consentAt,
        })
        .from(latest)
        .leftJoin(
          customerProfiles,
          and(
            eq(customerProfiles.tenantId, tenantId),
            eq(customerProfiles.phone, latest.phone),
          ),
        )
        .orderBy(desc(latest.lastAppointmentAt))
        .limit(overrideLimit ?? query.limit),
      this.database.db
        .select({
          total: sql<number>`count(distinct ${appointments.customerPhone})::int`,
        })
        .from(appointments)
        .where(where),
      this.database.db
        .select({
          phone: appointments.customerPhone,
          count: sql<number>`count(*)::int`,
        })
        .from(appointments)
        .where(where)
        .groupBy(appointments.customerPhone),
    ]);

    const countByPhone = new Map(
      counts.map((entry) => [entry.phone, entry.count]),
    );

    return {
      items: rows.map((row) =>
        toItem({ ...row, appointmentCount: countByPhone.get(row.phone) ?? 0 }),
      ),
      total: totals[0]?.total ?? 0,
    };
  }

  async detail(tenantId: string, phone: string): Promise<CustomerDetail> {
    const rows = await this.database.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.customerPhone, phone),
        ),
      )
      .orderBy(desc(appointments.startsAt));

    const newest = rows[0];

    if (!newest) {
      throw new NotFoundException('Customer not found');
    }

    const profile = await this.database.db.query.customerProfiles.findFirst({
      where: and(
        eq(customerProfiles.tenantId, tenantId),
        eq(customerProfiles.phone, phone),
      ),
    });

    return {
      phone: newest.customerPhone,
      name: profile?.name ?? newest.customerName,
      email: profile?.email ?? newest.customerEmail,
      customerId: profile?.customerId ?? newest.customerId,
      profileId: profile?.id ?? null,
      notes: profile?.notes ?? null,
      consentAt: profile?.consentAt?.toISOString() ?? null,
      appointmentCount: rows.length,
      lastAppointmentAt: newest.startsAt.toISOString(),
      history: rows.map(toHistory),
    };
  }

  async update(
    tenantId: string,
    phone: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerDetail> {
    const current = await this.detail(tenantId, phone);
    const existing = current.profileId
      ? await this.database.db.query.customerProfiles.findFirst({
          where: and(
            eq(customerProfiles.id, current.profileId),
            eq(customerProfiles.tenantId, tenantId),
          ),
        })
      : undefined;
    const now = new Date();
    const consentAt =
      input.consent === undefined
        ? (existing?.consentAt ?? null)
        : input.consent
          ? (existing?.consentAt ?? now)
          : null;

    const values = {
      tenantId,
      phone,
      customerId: current.customerId,
      name: input.name ?? current.name,
      email: input.email ?? current.email,
      notes: input.notes ?? current.notes,
      consentAt,
      consentSource:
        input.consent === true ? 'panel' : (existing?.consentSource ?? null),
      updatedAt: now,
    };

    await this.database.db
      .insert(customerProfiles)
      .values(values)
      .onConflictDoUpdate({
        target: [customerProfiles.tenantId, customerProfiles.phone],
        set: values,
      });

    return this.detail(tenantId, phone);
  }

  async export(tenantId: string, q?: string): Promise<string> {
    const result = await this.list(tenantId, { q, limit: 200 }, 10_000);

    return customerCsv(result.items);
  }

  private filter(tenantId: string, q?: string) {
    const conditions = [eq(appointments.tenantId, tenantId)];

    if (q) {
      const pattern = `%${q}%`;
      conditions.push(
        or(
          ilike(appointments.customerName, pattern),
          ilike(appointments.customerPhone, pattern),
          ilike(appointments.customerEmail, pattern),
        )!,
      );
    }

    return and(...conditions);
  }
}

type ItemRow = {
  phone: string;
  name: string;
  email: string | null;
  customerId: string | null;
  profileId: string | null;
  notes: string | null;
  consentAt: Date | null;
  lastAppointmentAt: Date | null;
  appointmentCount: number;
};

function toItem(row: ItemRow): CustomerListItem {
  return {
    phone: row.phone,
    name: row.name,
    email: row.email,
    customerId: row.customerId,
    profileId: row.profileId,
    notes: row.notes,
    consentAt: row.consentAt?.toISOString() ?? null,
    appointmentCount: row.appointmentCount,
    lastAppointmentAt: row.lastAppointmentAt?.toISOString() ?? null,
  };
}

function toHistory(row: Appointment): CustomerHistoryEntry {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    serviceName: row.serviceName,
    staffName: row.staffName,
    priceCents: row.priceCents,
    depositType: row.depositType,
    depositValue: row.depositValue,
    notes: row.notes,
    statusReason: row.statusReason,
  };
}
