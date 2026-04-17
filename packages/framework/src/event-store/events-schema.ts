import { sql } from "drizzle-orm";
import type { DbConnection } from "../db";
import {
  bigserial,
  index,
  integer,
  jsonb,
  table as pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "../db/dialect";
import { pushTables } from "../testing";
import { createArchivedStreamsTable } from "./archive";
import { createSnapshotsTable } from "./snapshot";

// Event-store schema as a Drizzle table. The typed select/insert path handles
// most operations; append() for subsequent versions uses raw SQL because
// INSERT ... SELECT ... WHERE EXISTS isn't ergonomic in the typed builder.
//
// Columns map 1:1 to the spike schema (samples/spike-event-sourced). The
// partial unique index over `(tenant_id, (metadata->>'requestId'))` has to
// be applied as raw DDL because drizzle-kit's JSON schema generator doesn't
// express JSONB path expressions — see EVENTS_IDEMPOTENCY_INDEX_SQL below.
export type EventMetadata = {
  readonly userId: string;
  readonly requestId?: string;
};

export const eventsTable = pgTable(
  "events",
  {
    // bigserial PK: global chronological ordering cheap to index, safe past
    // 2^53 as long as we stay < ~9e15 events. Returned to JS as BigInt.
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    version: integer("version").notNull(),
    type: text("type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    metadata: jsonb("metadata").$type<EventMetadata>().notNull(),
    // Millisecond precision: JS Dates only carry ms, and asOf-queries
    // round-trip event.createdAt back through JS. Matching precisions avoids
    // μs-vs-ms comparison misses where an event with .123456 μs looks "after"
    // an asOf of .123 ms.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    // Text rather than uuid: the framework's SessionUser.id is a number
    // (serial) by default. Stringified here so both integer- and UUID-shaped
    // user ids round-trip cleanly. Aggregate-IDs stay uuid because events are
    // aggregated by UUID end-to-end.
    createdBy: text("created_by").notNull(),
  },
  (t) => ({
    aggregateVersionUq: uniqueIndex("events_aggregate_version_uq").on(t.aggregateId, t.version),
    loadIdx: index("events_load_idx").on(t.aggregateId, t.version),
    tenantTypeIdx: index("events_tenant_type_idx").on(t.tenantId, t.aggregateType, t.createdAt),
  }),
);

// Partial unique index enforcing per-tenant request-id idempotency. Filtered
// on NOT NULL so events without a requestId don't all collide on the null
// value. Raw DDL — same pattern as EVENT_OUTBOX_PARTIAL_INDEX_SQL.
export const EVENTS_IDEMPOTENCY_INDEX_SQL = sql`
  CREATE UNIQUE INDEX IF NOT EXISTS events_idempotency_idx
    ON events (tenant_id, ((metadata->>'requestId')))
    WHERE metadata->>'requestId' IS NOT NULL;
`;

// Convenience used by framework integration tests. Creates the table via
// drizzle-kit diffing and adds the partial idempotency index. Idempotent —
// setupTestStack calls it automatically, so tests that also call it manually
// (legacy setup, explicit layout) don't fail.
//
// Also materializes kumiko_archived_streams and kumiko_snapshots:
// loadAggregate / appendEvent / loadAggregateWithSnapshot consult them on
// the hot path, so the three tables must come up together.
export async function createEventsTable(db: DbConnection): Promise<void> {
  const [row] = (await db.execute(
    sql`SELECT to_regclass('public.events') IS NOT NULL AS exists`,
  )) as unknown as Array<{ exists: boolean }>;
  // skip: events table already exists — createEventsTable is called from both
  // setupTestStack and explicit test-setups, the guard keeps it idempotent.
  if (!row?.exists) {
    await pushTables(db, { events: eventsTable });
    await db.execute(EVENTS_IDEMPOTENCY_INDEX_SQL);
  }
  await createArchivedStreamsTable(db);
  await createSnapshotsTable(db);
}
