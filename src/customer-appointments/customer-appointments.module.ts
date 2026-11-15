import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { CustomerAppointmentsController } from './customer-appointments.controller.js';
import { CustomerAppointmentsService } from './customer-appointments.service.js';

@Module({
  imports: [AppointmentsModule],
  controllers: [CustomerAppointmentsController],
  providers: [CustomerAppointmentsService],
})
export class CustomerAppointmentsModule {}
