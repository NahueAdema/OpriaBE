import type { ServiceDepositType } from '../database/schema/index.js';

export interface DepositInput {
  depositType: ServiceDepositType;
  /** Cents when fixed, 0-100 when percentage, 0 when none. */
  depositValue: number;
  priceCents: number;
}

/**
 * Cross-field deposit rules shared by create/update. Returns a human readable
 * message when the combination is invalid.
 */
export function depositValidationMessage(
  input: DepositInput,
): string | undefined {
  if (input.depositType === 'none' && input.depositValue !== 0) {
    return 'depositValue must be 0 when depositType is none';
  }

  if (
    input.depositType === 'percentage' &&
    (input.depositValue < 0 || input.depositValue > 100)
  ) {
    return 'depositValue must be between 0 and 100 for percentage deposits';
  }

  if (input.depositType === 'fixed' && input.depositValue > input.priceCents) {
    return 'depositValue cannot exceed priceCents for fixed deposits';
  }

  return undefined;
}
