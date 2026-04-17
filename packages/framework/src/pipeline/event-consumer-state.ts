import { sql } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
import { bigint, index, integer, table as pgTable, text, timestamp } from "../db/dialect";
import { pushTables } from "../testing";

// Framework-level state per event-consumer. A "consumer" is anything that
// walks the events-table via a persistent cursor: postEvent subscribers
// (SSE, Search, feature listeners) and — once it lands — async projections.
//
// One row per consumer name. Read by the event-dispatcher (cursor + locking),
// surfaced by the CLI for ops inspection. Sits next to kumiko_projections —
// same lifecycle shape, different semantics:
//
//   - kumiko_projections = inline / rebuild cursor for read-models
//   - kumiko_event_consumers = async cursor for post-commit subscribers
//
// The two tables are kept separate so a rebuild CLI never races a live
// async consumer, and ops can see both health surfaces independently.
//
// Columns:
//   - name: consumer's qualified identifier, e.g. "system:consumer:sse" or
//     "my-feature:consumer:analytics". Matches the qualified-name convention
//     so two features can't accidentally collide on the same consumer name.
//   - lastProcessedEventId: bigserial `events.id` of the most recent event
//     the consumer finished handling. Dispatcher reads events WHERE id > this.
//   - status: "idle" (has a cursor, ready for next pass)
//           | "processing" (current pass locked this row; released on commit)
//           | "dead" (hit maxAttempts on the same event; paused until ops
//              intervenes — other consumers keep running)
//           | "disabled" (ops manually paused this consumer)
//   - attempts: retry counter for the CURRENT event. Resets on success.
//     Dead-letter kicks in at configured maxAttempts.
//   - lastError: last error message when status = "dead". Kept verbatim so
//     ops can see the exact handler throw.
//   - updatedAt: wall-clock time of last status/cursor change. Drives
//     lag-metric once we add one.
//
// The default(sql`0`) on lastProcessedEventId mirrors projection-state.ts:
// drizzle-kit's JSON snapshot generator can't serialise a bigint literal, so
// the server-side default is specified as raw SQL instead of .default(0n).
export const eventConsumerStateTable = pgTable(
  "kumiko_event_consumers",
  {
    name: text("name").primaryKey(),
    lastProcessedEventId: bigint("last_processed_event_id", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    status: text("status").notNull().default("idle"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("kumiko_event_consumers_status_idx").on(t.status),
  }),
);

export const CONSUMER_STATUSES = ["idle", "processing", "dead", "disabled"] as const;
export type ConsumerStatus = (typeof CONSUMER_STATUSES)[number];

// Idempotent bootstrap. Called by setupTestStack + production boot path —
// same pattern as createProjectionStateTable / createEventsTable. If the
// table is already present (second stack in the same test DB, prod boot
// after migration), skip cleanly.
export async function createEventConsumerStateTable(db: DbConnection): Promise<void> {
  const [row] = (await db.execute(
    sql`SELECT to_regclass('public.kumiko_event_consumers') IS NOT NULL AS exists`,
  )) as unknown as Array<{ exists: boolean }>;
  // skip: table already exists — bootstrap is called from multiple paths
  if (row?.exists) return;
  await pushTables(db, { kumikoEventConsumers: eventConsumerStateTable });
}
