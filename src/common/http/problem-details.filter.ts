import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { STATUS_CODES } from 'node:http';
import { ZodError } from 'zod';
import type { Env } from '../../config/env.js';
import type { ValidationIssue } from '../zod/zod-validation.pipe.js';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: ValidationIssue[];
}

interface NormalizedException {
  status: number;
  detail?: string;
  code?: string;
  errors?: ValidationIssue[];
}

/**
 * Renders every error as RFC 9457 Problem Details
 * (`application/problem+json`), so clients get one predictable shape instead
 * of Nest's default `{ statusCode, message, error }` or Fastify's 404 body.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);
  private readonly isProduction: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.isProduction =
      config.get('NODE_ENV', { infer: true }) === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    if (reply.sent) {
      return;
    }

    const { status, detail, errors, code } = this.normalize(exception);

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      ...(detail ? { detail } : {}),
      instance: request.url,
      ...(code ? { code } : {}),
      ...(errors ? { errors } : {}),
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${request.method} ${request.url} failed with ${status}`,
        stack,
      );
    }

    void reply
      .status(status)
      .type('application/problem+json')
      .send(problem);
  }

  private normalize(exception: unknown): NormalizedException {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        detail: 'Request validation failed',
        errors: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      return this.normalizeHttpException(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: this.isProduction
        ? 'Internal server error'
        : exception instanceof Error
          ? exception.message
          : 'Internal server error',
    };
  }

  private normalizeHttpException(exception: HttpException): NormalizedException {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { status, detail: response };
    }

    if (response && typeof response === 'object') {
      const body = response as Record<string, unknown>;
      const message = body.message;

      return {
        status,
        detail: Array.isArray(message)
          ? message.join('; ')
          : typeof message === 'string'
            ? message
            : undefined,
        code: typeof body.code === 'string' ? body.code : undefined,
        errors: Array.isArray(body.errors)
          ? (body.errors as ValidationIssue[])
          : undefined,
      };
    }

    return { status };
  }
}
