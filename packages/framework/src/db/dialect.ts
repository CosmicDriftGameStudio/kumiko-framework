// Central re-export for all PostgreSQL-specific imports.
// No other file in the framework should import from "drizzle-orm/pg-core" directly.

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
