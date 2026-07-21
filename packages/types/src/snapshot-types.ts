import type { StoredEvent } from "./event-store-types";

// Reducer used to fold events onto a state. Kept narrow and pure — the
// caller supplies the shape and update rules. Mirrors the reducer shape
// feature authors already write for r.projection.apply.
export type SnapshotReducer<TState extends Record<string, unknown>> = (
  state: TState,
  event: StoredEvent,
) => TState;

export type LoadAggregateWithSnapshotResult<TState extends Record<string, unknown>> = {
  readonly state: TState;
  readonly version: number;
  readonly snapshotHit: boolean;
};

export type LoadAggregateWithSnapshotOptions = {
  // Opt-in: include archived streams in the rehydrate. Default false — same
  // semantics as loadAggregate / loadAggregateAsOf. Archive check is a
  // single indexed lookup, so the cost stays negligible on the hot path.
  readonly includeArchived?: boolean;
  // Optional upcaster step: every delta event goes through this transform
  // BEFORE the reducer sees it. The dispatcher wires this up with
  // r.eventMigration so feature code always sees current-version payloads.
  // Async to support Marten-style AsyncOnlyEventUpcaster (DB lookups).
  readonly upcastEvent?: (event: StoredEvent) => Promise<StoredEvent>;
  // Auto-snapshot policy: when the fold applied at least this many delta
  // events, persist a fresh snapshot at the folded version (best-effort —
  // a failed save never fails the load). Omit to keep snapshotting manual.
  readonly snapshotEvery?: number;
  // Reducer-shape generation stamped onto saved snapshots (default 1). A
  // stored snapshot with a different generation is ignored — full replay
  // through the upcaster chain — and restamped on the next auto-save. Bump
  // whenever the reducer's state shape changes.
  readonly snapshotVersion?: number;
};
