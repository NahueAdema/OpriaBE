import type { AppointmentStatus } from '../database/schema/index.js';

/**
 * Allowed status changes. Everything else is a conflict: the business cannot
 * re-open a rejected request or move a finished appointment back to pending.
 */
const allowedTransitions: Record<
  AppointmentStatus,
  readonly AppointmentStatus[]
> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  rejected: [],
  cancelled: [],
  completed: [],
  no_show: [],
};

/** Only these statuses keep their time range blocked. */
export function isBlockingStatus(status: AppointmentStatus): boolean {
  return status === 'pending' || status === 'confirmed';
}

export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function nextStatuses(
  status: AppointmentStatus,
): readonly AppointmentStatus[] {
  return allowedTransitions[status];
}
