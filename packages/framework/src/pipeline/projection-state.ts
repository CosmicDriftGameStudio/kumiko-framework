import { sql } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
import { bigint, index, table as pgTable, text, timestamp } from "../db/dialect";
import { pushTables } from "../testing";

// Framework-level state for every registered projection. One row per qualified
// projection name. Written by the rebuild machinery; read by the CLI + any
// status dashboard. Lives alongside the events table as framework infra —
// user projection tables stay separate and user-owned.
//
// Columns:
//   - name: projection's qualified name (feature:projection:shortname)
//   - lastProcessedEventId: the bigserial `events.id` of the most recent
//     event that was applied. Rebuild uses it as the cursor for what's
//     done; live writes DON'T currently update it (synchronous apply means
//     no meaningful lag, see projections-runner.ts). Once async apply lands
//     in B.3+, this becomes the lag source.
//   - status: "idle" (normal) | "rebuilding" (in-progress) | "failed"
//   - lastRebuildAt: wall-clock time the last full rebuild finished
//   - lastError: last error message when status = "failed" — rebuild sets
//     this from the thrown message so ops can see it in `project status`
// last_processed_event_id uses a raw DEFAULT 0 instead of .default(0n) because
// drizzle-kit's JSON snapshot generator cannot serialise bigint literals —
// `TypeError: Do not know how to serialize a BigInt` bubbles through
// pushTables → generateMigration. `sql\`0\`` yields the same server-side
// default without ever putting a bigint in a generated-JSON path.
export const projectionStateTable = pgTable(
  "kumiko_projections",
  {
    name: text("name").primaryKey(),
    lastProcessedEventId: bigint("last_processed_event_id", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    status: text("status").notNull().default("idle"),
    lastRebuildAt: timestamp("last_rebuild_at", { withTimezone: true, precision: 3 }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("kumiko_projections_status_idx").on(t.status),
  }),
);

export const PROJECTION_STATUSES = ["idle", "rebuilding", "failed"] as const;
export type ProjectionStatus = (typeof PROJECTION_STATUSES)[number];

// Idempotent table bootstrap. Called by setupTestStack (and createApp once
// that wires it up) — same pattern as createEventsTable. If the table is
// already there (second stack in same test DB, production boot after
// migration), skip cleanly.
export async function createProjectionStateTable(db: DbConnection): Promise<void> {
  const [row] = (await db.execute(
    sql`SELECT to_regclass('public.kumiko_projections') IS NOT NULL AS exists`,
  )) as unknown as Array<{ exists: boolean }>;
  // skip: table already exists — bootstrap is called from multiple paths
  if (row?.exists) return;
  await pushTables(db, { kumikoProjections: projectionStateTable });
}
