// Bun.SQL server errors carry the SQLSTATE in `errno` and the constraint in
// `constraint` (`code` is the generic ERR_POSTGRES_SERVER_ERROR). Client-side
// failures have no `errno`, so their `code` (e.g. ERR_POSTGRES_CONNECTION_CLOSED)
// is returned instead. The `.cause` chain is walked so wrapped errors resolve too.
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

const MAX_CAUSE_DEPTH = 8;

export type PgErrorInfo = {
  readonly code: string | undefined;
  readonly constraint_name: string | undefined;
};

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function infoOfLayer(layer: unknown): PgErrorInfo | null {
  const sqlState = stringOrUndefined(propertyOf(layer, "errno"));
  if (sqlState !== undefined) {
    return {
      code: sqlState,
      constraint_name: stringOrUndefined(propertyOf(layer, "constraint")),
    };
  }
  const code = stringOrUndefined(propertyOf(layer, "code"));
  return code === undefined ? null : { code, constraint_name: undefined };
}

export function extractPgError(e: unknown): PgErrorInfo | null {
  let current: unknown = e;
  // Depth cap doubles as cycle protection for self-referential causes.
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) return null;
    const info = infoOfLayer(current);
    if (info !== null) return info;
    current = propertyOf(current, "cause");
  }
  return null;
}

// PG SQLSTATE 22007 invalid_datetime_format and 22008 datetime_field_overflow: the
// column type rejects the value ("not-a-date", or "2026-02-30" for a date column).
const INVALID_DATETIME_VALUE_CODES: ReadonlySet<string> = new Set(["22007", "22008"]);

export function isInvalidDateTimeValue(e: unknown): boolean {
  const code = extractPgError(e)?.code;
  return code !== undefined && INVALID_DATETIME_VALUE_CODES.has(code);
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

// PG SQLSTATE 42P01 — "undefined table". A projection table for an entity
// that was never mounted/rebuilt (or was dropped since) — callers treat
// this as "no row found", not as a fatal error.
export function isUndefinedTable(e: unknown): boolean {
  return extractPgError(e)?.code === "42P01";
}

// PG SQLSTATE 42501 insufficient_privilege: a row failing a row-level-security WITH CHECK policy.
export function isRowLevelSecurityViolation(e: unknown): boolean {
  return extractPgError(e)?.code === "42501";
}

export function constraintOf(e: unknown): string | undefined {
  return extractPgError(e)?.constraint_name;
}
