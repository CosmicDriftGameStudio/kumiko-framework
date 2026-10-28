import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createFallbackLogger } from "../logging/index.ts";
import { parseJsonSafe } from "../utils/safe-json.ts";
import type { TableInfo } from "./table-info.ts";
import { isTemporalInstant, isTemporalPlainDate } from "./temporal-value-guards.ts";

// --- Value coercion at the driver boundary ------------------------------
//
// The driver returns timestamptz as JS Date (or ISO string depending on
// driver config). Framework contract says timestamptz surfaces as
// Temporal.Instant — without coercion every read hands callers a Date and
// downstream code that does .epochMilliseconds / .add(...) crashes.
//
// Symmetric on write: Temporal.Instant doesn't bind directly as a driver
// param — convert to ISO string when the column pgType is timestamptz.

// Postgres bigint → JS: safe integers become `number` (matches createBigIntField /
// drizzle mode:"number"); values outside ±2^53 stay `bigint` (money cents, raw
// unmanaged columns). Uses BigInt equality check so 9007199254740993n never
// silently rounds to a safe integer.
function coerceBigIntFromDriver(value: bigint | string): bigint | number {
  let bi: bigint;
  if (typeof value === "string") {
    try {
      bi = BigInt(value);
    } catch {
      return value as unknown as bigint;
    }
  } else {
    bi = value;
  }
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (bi >= min && bi <= max) {
    const n = Number(bi);
    if (BigInt(n) === bi) return n;
  }
  return bi;
}

function instantFromDriver(value: unknown): Temporal.Instant | null {
  if (value === null || value === undefined) return null;
  if (isTemporalInstant(value)) return value;
  // Number coercion via +date — equivalent to .getTime() without a Date-API
  // method (guard-no-date-api). Date → epoch milliseconds, then to Temporal.Instant.
  if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(+value);
  if (typeof value === "string") {
    try {
      return Temporal.Instant.from(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "number") return Temporal.Instant.fromEpochMilliseconds(value);
  return null;
}

// Verified empirically: a `date`
// column comes back as a native JS Date, but ALWAYS anchored at UTC
// midnight regardless of process TZ — epochMilliseconds is stable across
// zones, only the local wall-clock read of that Date would drift the day
// (e.g. America/Los_Angeles reads back the 14th for a stored 15th). Routing
// through Instant→ZonedDateTimeISO("UTC")→PlainDate reads the calendar day
// back deterministically without ever touching a local Date getter — the
// same +value idiom instantFromDriver uses (guard-no-date-api: no
// `.getTime()`), just anchored to a fixed zone instead of process-local.
// A real `date` column always arrives as a UTC-midnight Date. Anything else means the column is
// still timestamptz (declared `date` before its ALTER ran); the UTC anchor then silently shifts
// the day, so say so once per column instead of returning the wrong day quietly.
const warnedNonMidnightDateColumns = new Set<string>();
const MS_PER_DAY = 86_400_000;
const dateColumnDriftLog = createFallbackLogger("bun-sql");

function warnIfNotDateColumn(epochMs: number, column: string): void {
  // skip: midnight value is a correct date column, and an already-warned column is deduped
  if (epochMs % MS_PER_DAY === 0 || warnedNonMidnightDateColumns.has(column)) return;
  warnedNonMidnightDateColumns.add(column);
  dateColumnDriftLog.warn(
    `column "${column}" is declared as date but returned a non-midnight timestamp; it is probably still timestamptz. Run the ALTER ... TYPE date migration, otherwise days can shift.`,
  );
}

function plainDateFromDriver(value: unknown, column: string): Temporal.PlainDate | null {
  if (value === null || value === undefined) return null;
  if (isTemporalPlainDate(value)) return value;
  if (typeof value === "string") {
    const isoDay = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
    if (isoDay === undefined) return null;
    try {
      return Temporal.PlainDate.from(isoDay);
    } catch {
      return null;
    }
  }
  if (value instanceof Date) {
    warnIfNotDateColumn(+value, column);
    return Temporal.Instant.fromEpochMilliseconds(+value).toZonedDateTimeISO("UTC").toPlainDate();
  }
  return null;
}

// Each coercer returns the coerced value, or `value` itself (same reference) when nothing applies.
type DriverValueCoercer = (value: unknown, column: string, info: TableInfo) => unknown;

function coerceTimestamptz(value: unknown): unknown {
  const instant = instantFromDriver(value);
  return instant !== null ? instant : value;
}

function coerceDate(value: unknown, column: string): unknown {
  const day = plainDateFromDriver(value, column);
  return day !== null ? day : value;
}

function coerceJsonb(value: unknown): unknown {
  return typeof value === "string" ? parseJsonSafe(value, value) : value;
}

function coerceBigIntColumn(value: unknown, column: string, info: TableInfo): unknown {
  if (typeof value !== "string" && typeof value !== "bigint") return value;
  if (info.bigintJsModeOf(column) === "number") return coerceBigIntFromDriver(value);
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      // leave as string on parse error
      return value;
    }
  }
  return value;
}

function numberUnlessNaN(value: unknown): unknown {
  if (typeof value !== "string" && typeof value !== "bigint") return value;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}

// Keyed by the driver's pgType string, not PgType: legacy tables report int4/smallint/int2.
const DRIVER_VALUE_COERCERS: ReadonlyMap<string, DriverValueCoercer> = new Map([
  ["timestamptz", coerceTimestamptz],
  ["timestamptz(3)", coerceTimestamptz],
  ["date", coerceDate],
  ["jsonb", coerceJsonb],
  ["bigint", coerceBigIntColumn],
  ["bigserial", coerceBigIntColumn],
  // Drivers may return int4 as bigint or numeric string.
  // Drizzle coerced to number for numberField columns — match that.
  ["integer", numberUnlessNaN],
  ["int4", numberUnlessNaN],
  ["smallint", numberUnlessNaN],
  ["int2", numberUnlessNaN],
]);

// pg returns numeric(p,s) as a string to preserve precision; the
// decimal-field contract surfaces it as JS number (safe ≤ 2^53). A
// non-numeric string would be DB corruption — leave it untouched so it
// surfaces loud downstream rather than becoming a silent NaN.
function driverValueCoercerFor(pgType: string | undefined): DriverValueCoercer | undefined {
  if (pgType === undefined) return undefined;
  const coercer = DRIVER_VALUE_COERCERS.get(pgType);
  if (coercer) return coercer;
  return pgType.startsWith("numeric") ? numberUnlessNaN : undefined;
}

const STANDALONE_VALUE_INFO: TableInfo = {
  name: "",
  columnOf: (field) => field,
  pgTypeOf: () => undefined,
  bigintJsModeOf: () => undefined,
  fieldOf: (column) => column,
  hasColumn: () => false,
};

// For computed values that have no table column: coerces by pg type exactly as a stored column of that type.
export function coerceDriverValueOfPgType(value: unknown, pgType: string, column: string): unknown {
  const coercer = driverValueCoercerFor(pgType);
  return coercer ? coercer(value, column, STANDALONE_VALUE_INFO) : value;
}

export function coerceDriverRow(
  row: Record<string, unknown>,
  info: TableInfo,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(row)) {
    // Blind-index columns are pure lookup artifacts — the
    // deterministic HMAC must never leak into caller/API responses.
    if ((key.endsWith("_bidx") || key.endsWith("Bidx")) && info.hasColumn(key)) {
      changed = true;
      continue;
    }
    const value = row[key];
    const coercer = driverValueCoercerFor(info.pgTypeOf(key));
    const coerced = coercer ? coercer(value, key, info) : value;
    const fieldName = info.fieldOf(key);
    if (fieldName !== key) changed = true;
    if (coerced !== value) changed = true;
    out[fieldName] = coerced;
  }
  return changed ? out : row;
}
