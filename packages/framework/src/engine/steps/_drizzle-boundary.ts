// Drizzle-boundary cast helper — drizzle's `db.insert()/select()/delete()`
// expect a PgTable<...> shape with `enableRLS` (driver-added). The
// abstract `Table` we accept on step args is missing that method, so
// TS rejects direct assignment. Runtime is identical — drizzle's
// builder methods only read the table-name + column-defs, both of
// which `Table` carries. Cast at the boundary, document it once.
//
// Used by read-find-one, read-find-many, unsafe-projection-upsert,
// unsafe-projection-delete. Followup #13 (closed at the M.1.6
// cleanup-pass).

import type { Table } from "drizzle-orm";

// biome-ignore lint/suspicious/noExplicitAny: drizzle type-boundary
type DrizzleQueryTarget = any;

export function asQueryTarget(t: Table): DrizzleQueryTarget {
  return t;
}
