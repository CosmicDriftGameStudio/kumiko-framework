// Tracking-Table für ES-Operations (Phase 1: seed-migrations; Phase 2+:
// projection-rebuild, event-replay, stream-migration, ... — siehe
// kumiko-platform/docs/plans/features/es-ops.md).
//
// File-ID-Tracking analog drizzle-kit: filename ist die ID, applied-set
// liegt in dieser Tabelle. Pending = files-on-disk MINUS applied-set.
//
// operation_type-Discriminator lässt Phase 2+ dieselbe Tabelle nutzen,
// kein Schema-Sprawl. CLI-Status filtert per type:
//   bunx kumiko ops seed:status      → operation_type = "seed-migration"
//   bunx kumiko ops projection:status → operation_type = "projection-rebuild"

// sql now comes from native dialect
import { type DbConnection, tableExists } from "../db";
import { sql, index, integer, table as pgTable, text, timestamp  } from "../db/dialect";
import { unsafePushTables } from "../stack";

export type EsOperationType = "seed-migration";
// Phase 2+ extensions — append here when implemented:
// | "projection-rebuild"
// | "event-replay"
// | "stream-migration"
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
    // Helps when forensics ask "wer hat das wann angestoßen".
    appliedBy: text("applied_by").notNull().$type<EsOperationAppliedBy>(),
    // Optional human-readable annotation — surfaced in `ops <op>:status`.
    notes: text("notes"),
  },
  (t) => ({
    typeIdx: index("kumiko_es_operations_type_idx").on(t.operationType),
  }),
);

// Convenience for tests + boot-time setup (idempotent). Mirrors the
// createEventsTable pattern in event-store/events-schema.ts.
export async function createEsOperationsTable(db: DbConnection): Promise<void> {
  if (!(await tableExists(db, "public.kumiko_es_operations"))) {
    await unsafePushTables(db, { kumikoEsOperations: esOperationsTable });
  }
}
