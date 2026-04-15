// Central re-export for all PostgreSQL-specific imports.
// No other file in the framework should import from "drizzle-orm/pg-core" directly.

import { customType } from "drizzle-orm/pg-core";

export type {
  PgSelect as SelectQuery,
  PgTableWithColumns as TableColumns,
} from "drizzle-orm/pg-core";
export {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable as table,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
