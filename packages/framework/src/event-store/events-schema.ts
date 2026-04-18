import { sql } from "drizzle-orm";
import { type DbConnection, tableExists } from "../db";
import {
  bigserial,
  index,
  instant,
  integer,
  jsonb,
  table as pgTable,
  text,
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
// HTTP-level retry idempotency is handled by pipeline/idempotency.ts
// (Redis-backed check + cached-response replay). The event-store itself
// imposes no idempotency index — a single HTTP request may write N events
// freely, metadata.requestId is purely a trace marker.
export type EventMetadata = {
  readonly userId: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
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
    // Millisecond precision: matches what asOf-queries can compare reliably.
    // Sprint F: instant() = Temporal.Instant round-trip via dialect.ts customType.
    createdAt: instant("created_at", { precision: 3 }).notNull().default(sql`now()`),
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

// Convenience used by framework integration tests. Creates the table via
// drizzle-kit diffing. Also materializes kumiko_archived_streams and
// kumiko_snapshots — loadAggregate / appendEvent / loadAggregateWithSnapshot
// consult them on the hot path, so the three tables must come up together.
export async function createEventsTable(db: DbConnection): Promise<void> {
  // skip: events table already exists — createEventsTable is called from both
  // setupTestStack and explicit test-setups, the guard keeps it idempotent.
  if (!(await tableExists(db, "public.events"))) {
    await pushTables(db, { events: eventsTable });
  }
  await createArchivedStreamsTable(db);
  await createSnapshotsTable(db);
}
