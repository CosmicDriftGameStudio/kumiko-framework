import type { AnyDb } from "../query.ts";
import type { TenantDb } from "../tenant-db.ts";
import { executeRawQueryRead } from "./raw-sql.ts";

// Called by createTenantDb with its inner runner; keeps raw SQL out of consumers.
// timestamptz(3): events.created_at has millisecond precision, a microsecond now() would compare later.
export async function queryDatabaseNow(runner: AnyDb): Promise<Date> {
  const [row] = await executeRawQueryRead<{ now: Date }>(
    runner,
    "SELECT now()::timestamptz(3) AS now",
  );
  if (!row) throw new Error("SELECT now() returned no row");
  return row.now;
}

/** Postgres clock; inside a transaction `now()` is the transaction start, so repeated reads agree. */
export function readDatabaseNow(db: TenantDb): Promise<Date> {
  return db.databaseNow();
}
