import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../config/env.js';

export const SIGNED_LINKS = Symbol('SIGNED_LINKS');

const actionLinkPayloadSchema = z.object({
  appointmentId: z.uuid(),
  tenantId: z.uuid(),
  /** Lowercased email the link was sent to; binds the link to its recipient. */
  recipient: z.email(),
  action: z.enum(['confirm', 'cancel']),
  expiresAt: z.number().int().positive(),
});

export type ActionLinkPayload = z.infer<typeof actionLinkPayloadSchema>;
export type ActionLinkInput = Omit<ActionLinkPayload, 'expiresAt'>;

/**
 * Domain separation: if no explicit secret is configured we derive one from
 * the JWT secret instead of reusing the same key material verbatim.
 */
export function deriveSigningSecret(jwtSecret: string): string {
  return createHmac('sha256', jwtSecret)
    .update('opria-notification-action-links-v1')
    .digest('hex');
}

/**
 * Stateless HMAC links for the emails: they let a guest confirm or cancel an
 * appointment without a session, expire on their own, and cannot be tampered
 * with. The signed payload is bound to the tenant, appointment, recipient and
 * action.
 */
@Injectable()
export class SignedLinksService {
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly ttlMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.secret =
      config.get('NOTIFICATION_SIGNING_SECRET', { infer: true }) ??
      deriveSigningSecret(config.get('JWT_ACCESS_SECRET', { infer: true }));

    const configuredUrl = config.get('PUBLIC_API_URL', { infer: true });
    const fallbackUrl =
      config.get('NODE_ENV', { infer: true }) === 'production'
        ? 'https://opriabe.onrender.com/v1'
        : 'http://127.0.0.1:3001/v1';

    this.baseUrl = (configuredUrl ?? fallbackUrl).replace(/\/$/, '');
    this.ttlMs =
      config.get('ACTION_LINK_TTL_HOURS', { infer: true }) * 3_600_000;
  }

  sign(payload: ActionLinkPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );

    return `${body}.${this.signature(body)}`;
  }

  /** Builds the absolute URL rendered into the email body. */
  actionUrl(input: ActionLinkInput, now = Date.now()): string {
    const token = this.sign({ ...input, expiresAt: now + this.ttlMs });

    return `${this.baseUrl}/public/appointments/${token}/${input.action}`;
  }

  verify(
    token: string,
    expectedAction?: ActionLinkPayload['action'],
  ): ActionLinkPayload | null {
    const [body, signature] = token.split('.');

    if (!body || !signature) {
      return null;
    }

    const expected = Buffer.from(this.signature(body));
    const received = Buffer.from(signature);

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return null;
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    const result = actionLinkPayloadSchema.safeParse(decoded);

    if (!result.success || result.data.expiresAt <= Date.now()) {
      return null;
    }

    if (expectedAction && result.data.action !== expectedAction) {
      return null;
    }

    return result.data;
  }

  private signature(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
