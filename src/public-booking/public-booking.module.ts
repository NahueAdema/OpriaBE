import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AvailabilityModule } from '../availability/availability.module.js';
import { PublicBookingController } from './public-booking.controller.js';
import { PublicBookingService } from './public-booking.service.js';

@Module({
  imports: [AvailabilityModule, AppointmentsModule],
  controllers: [PublicBookingController],
  providers: [PublicBookingService],
})
export class PublicBookingModule {}
