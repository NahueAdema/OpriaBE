import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env.js';
import { AppointmentNotificationsService } from './appointment-notifications.service.js';
import { ConsoleEmailProvider, EMAIL_PROVIDER } from './email.provider.js';
import { NotificationWorkerGuard } from './notification-worker.guard.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { SIGNED_LINKS, SignedLinksService } from './signed-links.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    AppointmentNotificationsService,
    NotificationWorkerGuard,
    {
      provide: SIGNED_LINKS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new SignedLinksService(config),
    },
    {
      provide: EMAIL_PROVIDER,
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger) => new ConsoleEmailProvider(logger),
    },
  ],
  exports: [
    NotificationsService,
    AppointmentNotificationsService,
    SIGNED_LINKS,
    EMAIL_PROVIDER,
  ],
})
export class NotificationsModule {}
