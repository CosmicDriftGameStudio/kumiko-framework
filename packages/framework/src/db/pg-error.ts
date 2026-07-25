// Drizzle wraps postgres-js errors in `DrizzleQueryError`; the original PG
// error (with SQLSTATE `code` and `constraint_name`) lives in `.cause`. We
// unwrap both layers so callers don't have to know which layer produced the
// error. Used by the event-store to distinguish a unique-violation on the
// aggregate-version index (optimistic-concurrency conflict) from the one on
// the idempotency-key index (caller-side replay signal).

export type PgErrorInfo = {
  readonly code: string | undefined;
  readonly constraint_name: string | undefined;
};

export function extractPgError(e: unknown): PgErrorInfo | null {
  if (typeof e !== "object" || e === null) return null;
  const layers: unknown[] = [e];
  // @cast-boundary error-details — DrizzleQueryError wraps PG-error in .cause
  const cause = (e as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) layers.push(cause);

  for (const layer of layers) {
    // @cast-boundary error-details — postgres-js error shape (code, constraint_name)
    const code = (layer as { code?: string }).code;
    const constraintName = (layer as { constraint_name?: string }).constraint_name; // @cast-boundary error-details
    if (code !== undefined || constraintName !== undefined) {
      return { code, constraint_name: constraintName };
    }
  }
  return null;
}

export function isUniqueViolation(e: unknown): boolean {
  return extractPgError(e)?.code === "23505";
}

// PG SQLSTATE 42P07 — "relation already exists". Raised when CREATE
// TABLE (or drizzle-kit's generated equivalent) runs against a table
// that's already been created. Useful for idempotent boot-paths like
// the dev-server, where a persistent DB carries the table over from
// the previous restart.
export function isTableAlreadyExists(e: unknown): boolean {
  return extractPgError(e)?.code === "42P07";
}

// PG SQLSTATE 55P03 — "lock not available". Raised by a NOWAIT-style lock
// request that couldn't be granted; a CREATE/DROP INDEX CONCURRENTLY racing
// another session's DDL on the same relation can hit this instead of a
// duplicate-relation error, depending on exact timing.
export function isLockNotAvailable(e: unknown): boolean {
  return extractPgError(e)?.code === "55P03";
}

export function constraintOf(e: unknown): string | undefined {
  return extractPgError(e)?.constraint_name;
}
