/**
 * Drizzle wraps driver errors in `DrizzleQueryError`, so the Postgres error
 * (with `code` and `constraint_name`) is found by walking the `cause` chain.
 */
function postgresErrorDetails(error: unknown): {
  code?: string;
  constraint?: string;
} {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== 'object') {
      return {};
    }

    const details = current as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (typeof details.code === 'string') {
      const constraint =
        typeof details.constraint_name === 'string'
          ? details.constraint_name
          : typeof details.constraint === 'string'
            ? details.constraint
            : undefined;

      return { code: details.code, constraint };
    }

    current = details.cause;
  }

  return {};
}

export function uniqueViolationConstraint(error: unknown): string | undefined {
  const { code, constraint } = postgresErrorDetails(error);

  return code === '23505' ? (constraint ?? 'unknown') : undefined;
}

/**
 * `23P01` is an exclusion constraint violation. Appointments use one to make
 * double booking impossible even when two requests race.
 */
export function isExclusionViolation(error: unknown): boolean {
  return postgresErrorDetails(error).code === '23P01';
}
