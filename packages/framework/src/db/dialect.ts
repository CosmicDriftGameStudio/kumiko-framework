// Central re-export for all PostgreSQL-specific imports.
// No other file in the framework should import from "drizzle-orm/pg-core" directly.

import { customType } from "drizzle-orm/pg-core";

export type {
  PgSelect as SelectQuery,
  PgTableWithColumns as TableColumns,
} from "drizzle-orm/pg-core";
export {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable as table,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Money column: BIGINT storing the integer minor unit (cents for EUR, yen
 * for JPY). Range ±9.2e18 in the DB; JS `number` is safe to 2^53 ≈ 9e15
 * minor units = ~90 trillion EUR. INTEGER would cap at ~21 million EUR per
 * row which is too tight for real-world invoices, bank balances, or bills
 * of sale — hence bigint.
 */
export const moneyAmount = customType<{ data: number; driverData: string | number }>({
  dataType() {
    return "bigint";
  },
  fromDriver(value: string | number): number {
    // node-postgres returns BIGINT as string by default; Bun's pg returns
    // number. Cast via Number() either way — safe because we stay under 2^53.
    return typeof value === "number" ? value : Number(value);
  },
  toDriver(value: number): number {
    return value;
  },
});

/**
 * Instant column: TIMESTAMPTZ storing a UTC instant, surfaced to JS as
 * `Temporal.Instant`. Replaces the old dual-mode situation (`mode:"date"`
 * for base fields vs `mode:"string"` for user-defined timestamp fields)
 * with a single round-trip type. See sprint-f-temporal.md for the migration.
 *
 * Driver-data is the ISO-8601 string the postgres driver actually exchanges.
 * `fromDriver` reads what the driver returns (postgres-js gives strings for
 * timestamptz) and parses through Temporal. `toDriver` writes the canonical
 * Temporal.Instant.toString() — the spike confirmed `eq/lte/gt/orderBy/
 * returning` accept Temporal.Instant directly without manual `.toString()`
 * at the call site.
 *
 * Boot-order note: `Temporal` must exist on globalThis before any
 * fromDriver/toDriver call. `ensureTemporalPolyfill()` runs at framework
 * boot. The closures here are lazy — they fire on read/write, not on
 * module load — so importing this file before the polyfill is safe.
 *
 * Optional `precision` (0..6) — fractional-second digits. Default 6 matches
 * PG's default `timestamptz`. Pass 3 for the events-table (ms precision —
 * matches what asOf-queries can compare reliably). Affects only CREATE TABLE
 * DDL via drizzle-kit; runtime parse handles any precision via Temporal.
 */
const instantBuilder = (config?: { precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6 }) =>
  customType<{ data: Temporal.Instant; driverData: string }>({
    dataType() {
      const p = config?.precision;
      return p !== undefined ? `timestamp(${p}) with time zone` : "timestamptz";
    },
    fromDriver(value: string): Temporal.Instant {
      return Temporal.Instant.from(value);
    },
    toDriver(value: Temporal.Instant | string): string {
      // Forgiving overload: payloads from custom write-handlers sometimes
      // arrive as ISO strings rather than Temporal.Instant (Zod insert-
      // schemas use z.iso.datetime, not a Temporal validator). Coerce
      // here at the boundary so the DB always sees a normalised string —
      // and Temporal.Instant.from throws on bad input, which is the right
      // failure mode (vs. the obscure "x.toString is not a function"
      // crash that hit feature authors before this overload existed).
      if (typeof value === "string") return Temporal.Instant.from(value).toString();
      return value.toString();
    },
  });
export function instant(name: string, config?: { precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6 }) {
  return instantBuilder(config)(name);
}
