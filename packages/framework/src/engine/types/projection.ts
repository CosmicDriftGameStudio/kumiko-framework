import type { DbRunner } from "../../db/connection";
import type { TableColumns } from "../../db/dialect";
import type { StoredEvent } from "../../event-store/event-store";

// Drizzle pgTable shape — projections hand their table through to apply() so
// user code writes upserts/updates directly instead of going through a
// framework-managed state reducer. Using Drizzle's own `PgTableWithColumns<any>`
// (re-exported as TableColumns) keeps typing honest: drizzle's typed paths work
// inside apply(), but the column union is erased so framework code doesn't need
// to know the schema shape of every user table.
// biome-ignore lint/suspicious/noExplicitAny: Drizzle's PgTable generic needs a concrete row shape; we erase it on purpose because the framework does not know user-defined column types.
export type ProjectionTable = TableColumns<any>;

// apply() receives the stored event plus the TX-scoped DbRunner (== db.raw inside
// the event-store-executor). Stay inside this tx; anything that throws rolls
// the event-append back as well.
export type ProjectionApplyFn = (event: StoredEvent, tx: DbRunner) => Promise<void>;

export type ProjectionDefinition = {
  readonly name: string;
  // One or more entity names whose events feed this projection. Event-types
  // are matched in `apply` (e.g. "unit.created") — `source` is only used to
  // index projections so the executor doesn't scan all projections on every
  // write.
  readonly source: string | readonly string[];
  // Drizzle-table the projection materializes into. User owns the schema —
  // framework just guarantees the TX and event delivery.
  readonly table: ProjectionTable;
  // Keyed by fully-qualified event type ("<aggregate>.<verb>", e.g. "unit.created").
  // Missing keys are silently skipped — a projection declares only the events it
  // cares about.
  readonly apply: Readonly<Record<string, ProjectionApplyFn>>;
};

// Marten-style MultiStreamProjection: aggregates events from many streams
// into one cross-cutting read-model. Unlike ProjectionDefinition (single-
// source, inline in the write-TX), an MSP is ASYNC — the event-dispatcher
// picks events off the log via its own cursor. Handlers MUST be idempotent
// because the dispatcher guarantees at-least-once delivery.
//
// Use for Sagas / process managers, customer-centric views that span
// multiple aggregate types, cross-feature aggregations, audit logs.
export type MultiStreamProjectionDefinition = {
  readonly name: string;
  readonly table: ProjectionTable;
  // Keyed by fully-qualified event type. Unlike a single-stream projection,
  // there is no source-entity hint — the MSP declares the event types it
  // cares about directly. Extract the identity/grouping key inside the
  // apply handler from the event payload.
  readonly apply: Readonly<Record<string, ProjectionApplyFn>>;
};
