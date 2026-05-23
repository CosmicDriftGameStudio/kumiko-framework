// sql now comes from native dialect
import type { DbConnection } from "../db/connection";
import { sql, bigint, index, instant, integer, table as pgTable, primaryKey, text  } from "../db/dialect";
import { tableExists } from "../db/schema-inspection";
import { unsafePushTables } from "../stack";

// Reserved sentinel used in the instance_id column for consumers whose
// delivery is "shared" — i.e. one cursor across all dispatcher instances
// (the default, pre-Welle-2.7 behaviour). Per-instance consumers store
// the concrete instanceId. Postgres PK columns can't be NULL and
// `NULL = NULL` is UNKNOWN in SQL — a nullable instance_id would break
// both uniqueness and PK constraints. The boot-validator refuses to
// start with KUMIKO_INSTANCE_ID === SHARED_INSTANCE_SENTINEL so the
// sentinel can never collide with a real instance identifier.
export const SHARED_INSTANCE_SENTINEL = "__shared__";

// Framework-level state per event-consumer-shard. A "consumer" is anything
// that walks the events-table via a persistent cursor: system consumers
// (SSE, Search) and feature multiStreamProjections (async, cross-aggregate).
//
// One row per (consumer name, instance_id) shard. Shared-delivery consumers
// have exactly one row with instance_id = SHARED_INSTANCE_SENTINEL — this
// preserves the pre-Welle-2.7 single-cursor semantic unchanged. Per-instance
// consumers get N rows (one per dispatcher instance), each with its own
// cursor — used by SSE so every API process pushes the same events to its
// own clients without a pub/sub transport. Read by the event-dispatcher
// (cursor + locking), surfaced by the CLI for ops inspection.
//
// Columns:
//   - name: consumer's qualified identifier, e.g. "system:consumer:sse" or
//     "my-feature:consumer:analytics". Matches the qualified-name convention
//     so two features can't accidentally collide on the same consumer name.
//   - instanceId: SHARED_INSTANCE_SENTINEL for shared-delivery consumers;
//     concrete process-local identifier (ServerOptions.instanceId, defaults
//     to KUMIKO_INSTANCE_ID or a boot-time UUID) for per-instance consumers.
//   - lastProcessedEventId: bigserial `events.id` of the most recent event
//     this shard finished handling. Dispatcher reads events WHERE id > this.
//   - status / attempts / lastError / updatedAt — per shard.
//
// Composite PK (name, instance_id): Postgres requires NOT NULL on all PK
// columns, and `NULL = NULL` is UNKNOWN in SQL — nullable instance_id would
// break uniqueness for shared rows. Sentinel avoids both hazards with one
// uniform column shape.
//
// CAUTION (retention-guard + scale-down):
//   pruneEvents refuses to delete past MIN(lastProcessedEventId) across ALL
//   shards. A decommissioned instance leaves its row behind at its last
//   cursor — prune is then pinned indefinitely. Before scaling down,
//   delete stale per-instance shards:
//     DELETE FROM kumiko_event_consumers WHERE instance_id = '<decommissioned>'
//   TODO: auto-cleanup via heartbeat-liveness — follow-up, not in v1.
//
// The default(sql`0`) on lastProcessedEventId mirrors projection-state.ts:
// drizzle-kit's JSON snapshot generator can't serialise a bigint literal, so
// the server-side default is specified as raw SQL instead of .default(0n).
export const eventConsumerStateTable = pgTable(
  "kumiko_event_consumers",
  {
    name: text("name").notNull(),
    instanceId: text("instance_id").notNull().default(SHARED_INSTANCE_SENTINEL),
    lastProcessedEventId: bigint("last_processed_event_id", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    status: text("status").notNull().default("idle"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: instant("updated_at", { precision: 3 }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.name, t.instanceId] }),
    statusIdx: index("kumiko_event_consumers_status_idx").on(t.status),
  }),
);

// Object-const form lets call sites write `ConsumerStatuses.disabled` instead
// of the raw string, which keeps status checks refactor-safe. The runtime
// value on each field is the same string the DB stores — no mapping needed.
export const ConsumerStatuses = {
  idle: "idle",
  processing: "processing",
  dead: "dead",
  disabled: "disabled",
} as const;
export type ConsumerStatus = (typeof ConsumerStatuses)[keyof typeof ConsumerStatuses];

// Idempotent bootstrap. Called by setupTestStack + production boot path —
// same pattern as createProjectionStateTable / createEventsTable. If the
// table is already present (second stack in the same test DB, prod boot
// after migration), skip cleanly.
//
export async function createEventConsumerStateTable(db: DbConnection): Promise<void> {
  // skip: table already exists — bootstrap is called from multiple paths
  if (await tableExists(db, "public.kumiko_event_consumers")) return;
  await unsafePushTables(db, { kumikoEventConsumers: eventConsumerStateTable });
}
