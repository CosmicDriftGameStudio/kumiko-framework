import { sql } from "drizzle-orm";
import type { DbConnection, DbTx } from "./connection";

// True when `<fullyQualifiedName>` refers to an existing relation in the
// current database. Thin wrapper over `to_regclass`, which returns NULL
// when the name doesn't resolve — the only postgres query that cheaply
// reports existence without raising an error on a missing relation.
//
// Used by framework-managed tables (events, archived_streams, snapshots,
// projections, event-consumers) whose createX() is called from multiple
// boot paths (setupTestStack, production boot, manual test setups). The
// guard keeps those calls idempotent without having to interpret the
// "already exists" error code.
//
//   if (await tableExists(db, "public.events")) return;
//   await unsafePushTables(db, { events: eventsTable });
export async function tableExists(
  db: DbConnection | DbTx,
  fullyQualifiedName: string,
): Promise<boolean> {
  const rows = await db.execute<{ exists: boolean }>(
    sql`SELECT to_regclass(${fullyQualifiedName}) IS NOT NULL AS exists`,
  );
  return rows[0]?.exists ?? false;
}
