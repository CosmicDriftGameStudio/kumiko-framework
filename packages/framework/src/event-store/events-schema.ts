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
import { pushTables } from "../stack";
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
  // App-specific free key/value (Marten "headers"). Mirror of the canonical
  // type in event-store.ts — kept duplicate because events-schema must stay
  // import-cycle-free vs the event-store module.
  readonly headers?: Readonly<Record<string, string | number | boolean>>;
};

export const eventsTable = pgTable(
  "kumiko_events",
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
    // Tenant-scoped unique: two tenants that happen to pick the same
    // aggregate_id (deterministic IDs, replay, restores) don't collide, and
    // insertFirstEvent needs no extra tenant check for cross-tenant safety —
    // the constraint itself guarantees it. For expectedVersion > 0 the raw
    // INSERT … SELECT … WHERE EXISTS still pairs the predecessor with the
    // same tenant, which is now just predecessor-existence and no longer
    // doing double duty as an anti-hijack check.
    aggregateVersionUq: uniqueIndex("events_aggregate_version_uq").on(
      t.tenantId,
      t.aggregateId,
      t.version,
    ),
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
  if (!(await tableExists(db, "public.kumiko_events"))) {
    await pushTables(db, { kumikoEvents: eventsTable });
  }
  await createArchivedStreamsTable(db);
  await createSnapshotsTable(db);
}
