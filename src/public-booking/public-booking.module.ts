import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AvailabilityModule } from '../availability/availability.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PublicAppointmentActionsController } from './public-appointment-actions.controller.js';
import { PublicAppointmentActionsService } from './public-appointment-actions.service.js';
import { PublicBookingController } from './public-booking.controller.js';
import { PublicBookingService } from './public-booking.service.js';

@Module({
  imports: [AvailabilityModule, AppointmentsModule, NotificationsModule],
  controllers: [PublicBookingController, PublicAppointmentActionsController],
  providers: [PublicBookingService, PublicAppointmentActionsService],
})
export class PublicBookingModule {}
