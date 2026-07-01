// Dead-letter storage for apply-handler failures during projection rebuild.
//
// Background: rebuildProjection / rebuildMultiStreamProjection replay the
// event log through apply handlers inside ONE transaction. A single event
// whose (possibly years-old) payload makes its apply throw rolls the whole
// replay back — the projection stays permanently un-rebuildable until the
// event is repaired by hand. The upcaster dead-letter only quarantines
// upcast-TRANSFORM failures, not apply failures (#760).
//
// Quarantine mode (errorPolicy.skipApplyErrors on RebuildDeps, or
// MspErrorMode.rebuild.skipApplyErrors on the MSP definition) confines each
// apply to a savepoint: a throwing apply is rolled back, captured into
// `kumiko_rebuild_dead_letters`, and the replay continues. Replay-after-fix
// is a separate ops step — same stance as the upcaster dead-letter.

import type { DbConnection, DbRunner } from "../db/connection";
import { bigint, index, jsonb, table as pgTable, text, timestamp, uuid } from "../db/dialect";
import { tableExists } from "../db/schema-inspection";
import { unsafePushTables } from "../stack";
import type { StoredEvent } from "./event-store";

export const rebuildDeadLetterTable = pgTable(
  "kumiko_rebuild_dead_letters",
  {
    // Surrogate PK — the same event can land here across multiple rebuild
    // attempts before the fix ships, without unique-violation noise.
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    projectionName: text("projection_name").notNull(),
    // StoredEvent.id is surfaced as `string` (bigint serialised for JSON
    // safety) — stored as text to keep the round-trip identity.
    eventId: text("event_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    eventType: text("event_type").notNull(),
    errorMessage: text("error_message").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectionIdx: index("rebuild_dead_letters_projection_idx").on(t.projectionName),
    createdAtIdx: index("rebuild_dead_letters_created_at_idx").on(t.createdAt),
  }),
);

// Idempotent table-create. The rebuild runners call this before the rebuild
// tx whenever quarantine mode is active, so the opt-in works on databases
// provisioned before this table existed.
export async function createRebuildDeadLetterTable(db: DbConnection): Promise<void> {
  // skip: table already exists — bootstrap called from multiple paths
  if (await tableExists(db, "public.kumiko_rebuild_dead_letters")) return;
  await unsafePushTables(db, { kumikoRebuildDeadLetters: rebuildDeadLetterTable });
}

export type SkippedApply = {
  readonly event: StoredEvent;
  readonly error: unknown;
};

// Bulk-write, called ONCE at the end of a quarantining rebuild (inside its
// tx). Unqualified insert — during the rebuild the search_path points at the
// shadow schema, and this table exists only in public, so it falls through.
export async function recordRebuildDeadLetters(
  db: DbRunner,
  projectionName: string,
  skipped: readonly SkippedApply[],
): Promise<void> {
  const { insertMany } = await import("../bun-db/query");
  await insertMany(
    db,
    rebuildDeadLetterTable,
    skipped.map(({ event, error }) => ({
      projectionName,
      eventId: event.id,
      tenantId: event.tenantId,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      eventType: event.type,
      errorMessage: error instanceof Error ? error.message : String(error),
      payload: event.payload,
    })),
  );
}

export type RebuildDeadLetterRow = {
  readonly id: bigint;
  readonly projectionName: string;
  readonly eventId: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly eventType: string;
  readonly errorMessage: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
};

// Ops-side triage query, optionally scoped to one projection.
export async function listRebuildDeadLetters(
  db: DbConnection,
  options: { projectionName?: string; limit?: number } = {},
): Promise<readonly RebuildDeadLetterRow[]> {
  const { selectMany } = await import("../bun-db/query");
  const limit = options.limit ?? 100;
  const where =
    options.projectionName !== undefined ? { projectionName: options.projectionName } : undefined;
  return selectMany<RebuildDeadLetterRow>(db, rebuildDeadLetterTable, where, {
    orderBy: { col: "createdAt", direction: "desc" },
    limit,
  });
}
