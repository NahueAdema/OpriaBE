import { Injectable } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface NotificationMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: NotificationMessage): Promise<void>;
}

/**
 * Development-only provider. Production can swap this for Resend/SES without
 * touching the domain services: they only depend on `EmailProvider`.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  constructor(private readonly logger: PinoLogger) {}

  async send(message: NotificationMessage): Promise<void> {
    this.logger.log({
      to: message.to,
      subject: message.subject,
      msg: 'notification email (console provider)',
    });
  }
}
