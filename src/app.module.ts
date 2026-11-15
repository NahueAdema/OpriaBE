import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { BusinessModule } from './business/business.module.js';
import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { type Env, validateEnv } from './config/env.js';
import { CustomerAppointmentsModule } from './customer-appointments/customer-appointments.module.js';
import { CustomerAuthModule } from './customer-auth/customer-auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { PublicBookingModule } from './public-booking/public-booking.module.js';
import { ServicesModule } from './services/services.module.js';
import { StaffModule } from './staff/staff.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        const level = config.get('LOG_LEVEL', { infer: true });

        return {
          pinoHttp: {
            level: nodeEnv === 'test' ? 'silent' : level,
            autoLogging: {
              ignore: (request: { url?: string }) =>
                request.url?.startsWith('/health') ?? false,
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            transport:
              nodeEnv === 'development'
                ? {
                    target: 'pino-pretty',
                    options: {
                      singleLine: true,
                      colorize: true,
                      translateTime: 'SYS:HH:MM:ss.l',
                      ignore: 'pid,hostname',
                    },
                  }
                : undefined,
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
          limit: config.get('RATE_LIMIT_MAX', { infer: true }),
        },
      ],
    }),
    HealthModule,
    DatabaseModule,
    AuthModule,
    CustomerAuthModule,
    CustomerAppointmentsModule,
    BusinessModule,
    ServicesModule,
    StaffModule,
    AvailabilityModule,
    AppointmentsModule,
    PublicBookingModule,
  ],
  providers: [
    // Order matters: rate limit first, then authentication, then roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
