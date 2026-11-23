import { Module } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ConsoleEmailProvider, EMAIL_PROVIDER } from './email.provider.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  providers: [
    NotificationsService,
    {
      provide: EMAIL_PROVIDER,
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger) => new ConsoleEmailProvider(logger),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
