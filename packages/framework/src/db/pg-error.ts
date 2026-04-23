// Drizzle wraps postgres-js errors in `DrizzleQueryError`; the original PG
// error (with SQLSTATE `code` and `constraint_name`) lives in `.cause`. We
// unwrap both layers so callers don't have to know which layer produced the
// error. Used by the event-store to distinguish a unique-violation on the
// aggregate-version index (optimistic-concurrency conflict) from the one on
// the request-id idempotency index (replay signal).

export type PgErrorInfo = {
  readonly code: string | undefined;
  readonly constraint_name: string | undefined;
};

export function extractPgError(e: unknown): PgErrorInfo | null {
  if (typeof e !== "object" || e === null) return null;
  const layers: unknown[] = [e];
  const cause = (e as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) layers.push(cause);

  for (const layer of layers) {
    const code = (layer as { code?: string }).code;
    const constraintName = (layer as { constraint_name?: string }).constraint_name;
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

export function constraintOf(e: unknown): string | undefined {
  return extractPgError(e)?.constraint_name;
}
