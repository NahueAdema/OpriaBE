import { describe, expect, it } from 'vitest';
import type { AppointmentStatus } from '../database/schema/index.js';
import {
  canTransition,
  isBlockingStatus,
  nextStatuses,
} from './appointments.transitions.js';

const allStatuses: AppointmentStatus[] = [
  'pending',
  'confirmed',
  'rejected',
  'cancelled',
  'completed',
  'no_show',
];

describe('appointment transitions', () => {
  it('lets a pending request be confirmed, rejected or cancelled', () => {
    expect(nextStatuses('pending')).toEqual([
      'confirmed',
      'rejected',
      'cancelled',
    ]);
  });

  it('lets a confirmed appointment be completed, marked no-show or cancelled', () => {
    expect(nextStatuses('confirmed')).toEqual([
      'completed',
      'no_show',
      'cancelled',
    ]);
  });

  it('treats terminal statuses as final', () => {
    for (const status of [
      'rejected',
      'cancelled',
      'completed',
      'no_show',
    ] as const) {
      expect(nextStatuses(status)).toEqual([]);
    }
  });

  it('never allows an appointment to move back to pending', () => {
    for (const status of allStatuses) {
      expect(canTransition(status, 'pending')).toBe(false);
    }
  });

  it('rejects a self-transition', () => {
    for (const status of allStatuses) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('only blocks the slot while pending or confirmed', () => {
    expect(allStatuses.filter(isBlockingStatus)).toEqual([
      'pending',
      'confirmed',
    ]);
  });
});
