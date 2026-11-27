import {
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { canTransition } from '../appointments/appointments.transitions.js';
import { DatabaseService } from '../database/database.service.js';
import { appointments, tenants } from '../database/schema/index.js';
import { AppointmentNotificationsService } from '../notifications/appointment-notifications.service.js';
import {
  SIGNED_LINKS,
  SignedLinksService,
} from '../notifications/signed-links.js';
import type {
  ActionTokenParams,
  PublicAppointmentActionResponse,
} from './public-appointment-actions.schemas.js';

const MS_PER_HOUR = 3_600_000;

/**
 * Executes the actions linked in transactional emails. The HMAC token is the
 * credential: no session, no customer id in the URL, and the signature binds
 * tenant, appointment, recipient email and action.
 */
@Injectable()
export class PublicAppointmentActionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: AppointmentNotificationsService,
    @Inject(SIGNED_LINKS) private readonly links: SignedLinksService,
  ) {}

  async act(
    token: ActionTokenParams['token'],
    action: 'confirm' | 'cancel',
  ): Promise<PublicAppointmentActionResponse> {
    const link = this.links.verify(token, action);

    if (!link) {
      throw new UnauthorizedException('The link is invalid or has expired');
    }

    const row = await this.database.db
      .select({ appointment: appointments, tenant: tenants })
      .from(appointments)
      .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
      .where(
        and(
          eq(appointments.id, link.appointmentId),
          eq(appointments.tenantId, link.tenantId),
        ),
      )
      .then((rows) => rows[0]);

    if (!row) {
      throw new NotFoundException('Appointment not found');
    }

    const recipient = row.appointment.customerEmail?.toLowerCase() ?? '';

    if (!recipient || recipient !== link.recipient.toLowerCase()) {
      throw new UnauthorizedException(
        'The link does not belong to this appointment',
      );
    }

    const target = action === 'confirm' ? 'confirmed' : 'cancelled';

    if (!canTransition(row.appointment.status, target)) {
      throw new ConflictException(
        `Cannot ${action} an appointment in status ${row.appointment.status}`,
      );
    }

    if (action === 'cancel') {
      const deadline = new Date(
        row.appointment.startsAt.getTime() -
          row.tenant.cancellationHours * MS_PER_HOUR,
      );

      if (Date.now() > deadline.getTime()) {
        throw new ConflictException(
          `Cancellations are not allowed within ${row.tenant.cancellationHours} hours of the appointment`,
        );
      }
    }

    const statusReason = action === 'cancel' ? 'Cancelled by email link' : null;

    const updated = await this.database.db.transaction(async (tx) => {
      const [changed] = await tx
        .update(appointments)
        .set({ status: target, statusReason, statusChangedAt: new Date() })
        .where(
          and(
            eq(appointments.id, row.appointment.id),
            eq(appointments.tenantId, row.tenant.id),
            eq(appointments.status, row.appointment.status),
          ),
        )
        .returning();

      if (changed) {
        await this.notifications.statusChanged(
          changed,
          row.tenant,
          target,
          statusReason,
          tx,
        );
      }

      return changed;
    });

    if (!updated) {
      throw new ConflictException('The appointment changed, try again');
    }

    return { id: updated.id, status: updated.status };
  }
}
