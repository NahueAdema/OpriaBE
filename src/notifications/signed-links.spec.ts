import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { SignedLinksService } from './signed-links.js';

const secret = 'a-very-long-jwt-secret-for-tests-1234567890';
const values: Partial<Env> = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: secret,
  PUBLIC_API_URL: 'https://api.opria.test/v1',
  ACTION_LINK_TTL_HOURS: 1,
};

function service(): SignedLinksService {
  return new SignedLinksService({
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>);
}

const payload = {
  appointmentId: 'd36b4c9c-5e2c-4a9b-9d0d-1e1f2a3b4c5d',
  tenantId: 'e47c5d0d-6f3d-4bac-8e1e-2f2a3b4c5d6e',
  recipient: 'ana@example.com',
  action: 'cancel' as const,
  expiresAt: Date.now() + 3_600_000,
};

describe('SignedLinksService', () => {
  it('signs and verifies a link bound to the appointment and recipient', () => {
    const links = service();
    const token = links.sign(payload);

    expect(token.split('.')).toHaveLength(2);
    expect(links.verify(token, 'cancel')).toEqual(payload);
  });

  it('builds an absolute action URL with the expected route', () => {
    const links = service();
    const url = links.actionUrl({
      appointmentId: payload.appointmentId,
      tenantId: payload.tenantId,
      recipient: payload.recipient,
      action: 'cancel',
    });

    expect(url).toMatch(
      /^https:\/\/api\.opria\.test\/v1\/public\/appointments\/[^/]+\/cancel$/,
    );
  });

  it('rejects tampered, expired and wrong-action tokens', () => {
    const links = service();
    const token = links.sign(payload);
    const [body, signature] = token.split('.');
    const tampered = `${body}x.${signature}`;

    expect(links.verify(tampered)).toBeNull();
    expect(links.verify(`${body}.deadbeef`)).toBeNull();
    expect(links.verify(token, 'confirm')).toBeNull();
    expect(
      links.verify(links.sign({ ...payload, expiresAt: Date.now() - 1 })),
    ).toBeNull();
    expect(links.verify('not-a-token')).toBeNull();
  });
});
