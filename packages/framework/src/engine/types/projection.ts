import type { DbRunner } from "../../db/connection";
import type { StoredEvent } from "../../event-store/event-store";

// Drizzle pgTable shape — projections hand their table through to apply() so
// user code writes upserts/updates directly instead of going through a
// framework-managed state reducer. Same shape buildDrizzleTable returns.
// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
export type ProjectionTable = Record<string, any>;

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
