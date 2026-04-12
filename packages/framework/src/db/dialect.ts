// Central re-export for all PostgreSQL-specific imports.
// No other file in the framework should import from "drizzle-orm/pg-core" directly.

import { customType } from "drizzle-orm/pg-core";

export type {
  PgSelect as SelectQuery,
  PgTableWithColumns as TableColumns,
} from "drizzle-orm/pg-core";
export {
  boolean,
  integer,
  numeric,
  pgTable as table,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * NUMERIC column that auto-converts to/from JS number.
 * Drizzle's built-in numeric returns strings — this returns numbers.
 * Precision is sufficient for money (up to ~9 quadrillion with 4 decimals).
 */
export const numericAsNumber = customType<{ data: number; driverData: string }>({
  dataType() {
    return "numeric(19, 4)";
  },
  fromDriver(value: string): number {
    return Number(value);
  },
});
