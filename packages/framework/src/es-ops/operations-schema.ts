// Tracks ES operations. The filename is the ID, so pending operations are files on disk minus the
// applied set. The operation_type discriminator lets different operation types share one table
// without schema sprawl; CLI status commands filter by type:
//   bunx kumiko ops seed:status      → operation_type = "seed-migration"
//   bunx kumiko ops projection:status → operation_type = "projection-rebuild"

import { type DbRunner, openUnboundedSiblingPool } from "../db/connection.ts";
import { index, integer, table as pgTable, sql, text, timestamp } from "../db/dialect.ts";
// sql now comes from native dialect
import { type DbConnection, tableExists } from "../db/index.ts";
import { acquireNamespacedAdvisoryLock } from "../db/queries/advisory-lock.ts";
import { ES_OPS_ADVISORY_LOCK_KEY } from "../db/queries/es-ops.ts";
import { unsafePushTables } from "../db/table-push.ts";

export type EsOperationType = "seed-migration" | "stream-migration" | "search-reindex";
// Extensions — append here when implemented:
// | "projection-rebuild"
// | "event-replay"
// | "aggregate-rebuild"
// | "archived-stream-purge"

export type EsOperationAppliedBy = "boot" | "cli" | "ci-pipeline";

export const esOperationsTable = pgTable(
  "kumiko_es_operations",
  {
    // Filename without extension serves as ID. Chronologically sortable
    // (date-prefix convention), human-meaningful, no separate hash needed.
    // Renaming a file = different ID = re-run; intentional (drizzle parity).
    id: text("id").primaryKey(),
    operationType: text("operation_type").notNull().$type<EsOperationType>(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    durationMs: integer("duration_ms").notNull(),
    // Trace: came from boot-time auto-apply, explicit CLI, or CI step.
    // Supports forensic questions about who initiated the operation and when.
    appliedBy: text("applied_by").notNull().$type<EsOperationAppliedBy>(),
    // Optional human-readable annotation — surfaced in `ops <op>:status`.
    notes: text("notes"),
  },
  (t) => ({
    typeIdx: index("kumiko_es_operations_type_idx").on(t.operationType),
  }),
);

const ES_OPERATIONS_DDL_LOCK_KEY = "kumiko_es_operations:ddl";

const SIBLING_POOL_CLOSE_TIMEOUT_SECONDS = 5;

// Replicas boot concurrently and CREATE TABLE IF NOT EXISTS is not race-safe: the loser trips
// pg_type_typname_nsp_index. The lock transaction pins one pool connection, so the re-check and
// DDL run on a sibling pool; asking the same pool again deadlocks at DATABASE_POOL_MAX=1 or when
// every connection is held by a waiting lock transaction.
export async function createEsOperationsTable(db: DbConnection): Promise<void> {
  // skip: the table exists, no lock needed on the common boot path.
  if (await tableExists(db, "public.kumiko_es_operations")) return;
  const sibling = openUnboundedSiblingPool(db);
  const ddlDb = sibling?.client ?? db;
  try {
    await db.begin(async (lockTx: DbRunner) => {
      await acquireNamespacedAdvisoryLock(
        lockTx,
        ES_OPS_ADVISORY_LOCK_KEY,
        ES_OPERATIONS_DDL_LOCK_KEY,
      );
      if (!(await tableExists(ddlDb, "public.kumiko_es_operations"))) {
        await unsafePushTables(ddlDb, { kumikoEsOperations: esOperationsTable });
      }
    });
  } finally {
    await sibling?.close(SIBLING_POOL_CLOSE_TIMEOUT_SECONDS);
  }
}
