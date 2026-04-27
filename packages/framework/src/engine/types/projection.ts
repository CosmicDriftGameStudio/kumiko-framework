import type { DbRunner } from "../../db/connection";
import type { TableColumns } from "../../db/dialect";
import type { StoredEvent } from "../../event-store/event-store";
import type { MultiStreamApplyContext } from "../../pipeline/multi-stream-apply-context";
import type { RunIn } from "./config";

// Drizzle pgTable shape — projections hand their table through to apply() so
// user code writes upserts/updates directly instead of going through a
// framework-managed state reducer. Using Drizzle's own `PgTableWithColumns<any>`
// (re-exported as TableColumns) keeps typing honest: drizzle's typed paths work
// inside apply(), but the column union is erased so framework code doesn't need
// to know the schema shape of every user table.
// biome-ignore lint/suspicious/noExplicitAny: Drizzle's PgTable generic needs a concrete row shape; we erase it on purpose because the framework does not know user-defined column types.
export type ProjectionTable = TableColumns<any>;

// Single-stream projection apply: runs inline in the write-TX of the event
// it projects. Gets the event + TX-scoped DbRunner — that's it. Inline
// projections must not spawn further events (no ctx) because they run
// inside the command's transaction and the framework guarantees a single
// commit boundary per command.
export type SingleStreamApplyFn = (event: StoredEvent, tx: DbRunner) => Promise<void>;

// Multi-stream projection apply: runs asynchronously via the event-dispatcher
// with its own cursor. Gets the event, tx, and a ctx surface for emitting
// follow-up events (saga / process-manager pattern). ctx.appendEvent +
// ctx.loadAggregate are the Marten-equivalent of IProjectionSession — write
// cross-aggregate reactions here, not in single-stream projections.
export type MultiStreamApplyFn = (
  event: StoredEvent,
  tx: DbRunner,
  ctx: MultiStreamApplyContext,
) => Promise<void>;

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
  readonly apply: Readonly<Record<string, SingleStreamApplyFn>>;
  // Auto-registered projection (one per r.entity) that exists ONLY to
  // make rebuildProjection work for entity-tables. Live writes go through
  // the EventStoreExecutor directly — firing the implicit apply inline
  // would double-write into the same table. The inline-projection-runner
  // skips entries with this flag; rebuildProjection treats them
  // identically to explicit projections.
  readonly isImplicit?: boolean;
};

// Per-lifecycle error policy for a MultiStreamProjection. Mirrors Marten's
// Projections.Errors / Projections.RebuildErrors split — a projection can
// be lenient during steady-state delivery but strict during rebuild (or
// vice versa).
export type MspErrorPolicy = {
  // When the apply handler throws: log the error, advance the cursor past
  // the offending event, and keep delivering. Default false — current
  // strict behaviour: retry up to maxAttempts, then mark the consumer
  // status="dead" and pause delivery. Use for best-effort sinks
  // (notifications, webhooks) where a single bad event should not stall
  // the whole consumer.
  readonly skipApplyErrors?: boolean;
};

export type MspErrorMode = {
  // Applied during steady-state dispatcher delivery.
  readonly continuous?: MspErrorPolicy;
  // Applied during rebuildProjection() / backfill passes. When omitted,
  // rebuild inherits continuous — explicit override common for "strict
  // during rebuild, lenient in production" patterns.
  readonly rebuild?: MspErrorPolicy;
};

// Marten-style MultiStreamProjection: aggregates events from many streams
// into one cross-cutting read-model. Unlike ProjectionDefinition (single-
// source, inline in the write-TX), an MSP is ASYNC — the event-dispatcher
// picks events off the log via its own cursor. Handlers MUST be idempotent
// because the dispatcher guarantees at-least-once delivery.
//
// Use for Sagas / process managers, customer-centric views that span
// multiple aggregate types, cross-feature aggregations, audit logs. With
// `table` omitted, the MSP becomes a pure side-effect consumer — sending
// notifications, posting webhooks, updating an external system. Marten's
// equivalent of a subscription / event listener, without a separate API.
export type MultiStreamProjectionDefinition = {
  readonly name: string;
  // Optional: omit for side-effect-only handlers (notifications, external
  // system sync). When present, setupTestStack auto-pushes the table.
  readonly table?: ProjectionTable;
  // Keyed by fully-qualified event type. Unlike a single-stream projection,
  // there is no source-entity hint — the MSP declares the event types it
  // cares about directly. Extract the identity/grouping key inside the
  // apply handler from the event payload.
  readonly apply: Readonly<Record<string, MultiStreamApplyFn>>;
  // How the dispatcher handles apply-throws. Default strict (retry + dead).
  readonly errorMode?: MspErrorMode;
  // Which deploy-lane runs this MSP's dispatcher. Default "worker". MSPs
  // share a single consumer-row per MSP name with SKIP LOCKED, so "both"
  // is safe semantically (API + Worker race for each event; exactly one
  // wins). Use "api" for MSPs that need in-process state on the API
  // (rare); use "both" only when genuinely load-balancing is helpful.
  readonly runIn?: RunIn;
  // Delivery semantics across multi-instance deploys:
  //   "shared"       (default) — one cursor across all dispatcher instances,
  //                   SKIP LOCKED serialises; each event delivered exactly
  //                   once globally. The right choice for side-effects with
  //                   any downstream state: notifications, external APIs,
  //                   projection tables, audit rows.
  //   "per-instance" — one cursor PER dispatcher instance, so every process
  //                   delivers every event. Required for push-to-local-
  //                   subscribers (SSE, in-memory caches): a split-deploy
  //                   where API instance B emits an event that API instance
  //                   A's clients also need to see. Handler MUST be
  //                   side-effect-free relative to the DB — it only reaches
  //                   in-process structures — otherwise each instance
  //                   writes duplicate rows. Misuse = duplicated side
  //                   effects, not a safety property.
  readonly delivery?: "shared" | "per-instance";
};
