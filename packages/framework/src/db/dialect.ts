// Central re-export for all PostgreSQL-specific imports.
// No other file in the framework should import from "drizzle-orm/pg-core" directly.

export {
  pgTable as table,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type { PgTableWithColumns as TableColumns } from "drizzle-orm/pg-core";
export type { PgSelect as SelectQuery } from "drizzle-orm/pg-core";
