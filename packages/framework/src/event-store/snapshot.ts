// sql now comes from native dialect

import type { DbConnection, DbRunner } from "../db/connection";
import {
  index,
  instant,
  integer,
  jsonb,
  table as pgTable,
  primaryKey,
  sql,
  text,
  uuid,
} from "../db/dialect";
import { upsertSnapshot } from "../db/queries/event-store";
import { selectMany } from "../db/query";
import { tableExists } from "../db/schema-inspection";
import type { TenantId } from "../engine/types";
import { unsafePushTables } from "../stack";
import { isStreamArchived } from "./archive";
import { loadEventsAfterVersion, type StoredEvent } from "./event-store";

// Marten-aligned snapshot store. A snapshot is a point-in-time materialised
// state of an aggregate at a specific version, cached so rehydrating the
// aggregate doesn't require replaying every historical event.
//
// Read path (loadAggregateWithSnapshot):
//   1. isStreamArchived? → honour same semantics as loadAggregate
//   2. loadLatestSnapshot → state + version N (or null)
//   3. loadEventsAfterVersion(aggregate, N) → only the delta
//   4. reducer(snapshot, delta) → current state
//
// Write path: feature authors opt in via ctx.snapshotAggregate. Policy
// (every N events, every M minutes, on-demand) is a feature-level decision
// — the framework only offers the storage primitive.
//
// Schema-migration policy: NO built-in snapshot versioning. A snapshot stores
// the aggregate state in the reducer's current shape. When the reducer's
// shape changes (added field, renamed property, moved compound), invalidate
// the cache — DELETE from kumiko_snapshots WHERE aggregate_type = '...'.
// The read path then falls back to full replay (which runs the upcaster
// chain on events) until the next snapshotAggregate call. Cheaper than a
// second migration mechanism; snapshots are a perf optimisation, not a
// source of truth.
//
// Upcaster interaction: the raw API (loadAggregateWithSnapshot below) does
// NOT apply the upcaster chain on delta events — same layering as raw
// loadAggregate. The Dispatcher wraps this into ctx.loadAggregateWithSnapshot
// and runs upcastStoredEvents on the delta before calling the reducer, so
// feature authors always see current-version payloads.

export const snapshotsTable = pgTable(
  "kumiko_snapshots",
  {
    aggregateId: uuid("aggregate_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    // Kept even though (aggregate_id, version) is globally unique: the
    // schema-migration invalidation mechanism (see file header) filters by
    // aggregate_type, so storing it avoids a join on events just to
    // invalidate snapshots.
    aggregateType: text("aggregate_type").notNull(),
    // The version covered by this snapshot. `loadEventsAfterVersion`
    // returns events with version > this value.
    version: integer("version").notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    createdAt: instant("created_at", { precision: 3 }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.aggregateId, t.version] }),
    // Latest-snapshot lookup: WHERE aggregate_id = ? ORDER BY version DESC
    // LIMIT 1. With this index the planner does one seek + backward scan
    // instead of sort-and-limit.
    latestIdx: index("kumiko_snapshots_latest_idx").on(t.aggregateId, t.tenantId, t.version),
  }),
);

export async function createSnapshotsTable(db: DbConnection): Promise<void> {
  // skip: table already exists — idempotent boot + test-setup call
  if (await tableExists(db, "public.kumiko_snapshots")) return;
  await unsafePushTables(db, { kumikoSnapshots: snapshotsTable });
}

export type Snapshot<TState extends Record<string, unknown> = Record<string, unknown>> = {
  readonly aggregateId: string;
  readonly tenantId: TenantId;
  readonly aggregateType: string;
  readonly version: number;
  readonly state: TState;
  readonly createdAt: Temporal.Instant;
};

export type SaveSnapshotArgs = {
  readonly aggregateId: string;
  readonly tenantId: TenantId;
  readonly aggregateType: string;
  readonly version: number;
  readonly state: Record<string, unknown>;
};

// Upsert-style save so re-snapshotting the same (aggregateId, version) is
// idempotent. Caller can retake a snapshot at the same version without
// bespoke error handling — useful when a feature's snapshot policy runs
// during a concurrent retake.
export async function saveSnapshot(db: DbRunner, args: SaveSnapshotArgs): Promise<void> {
  await upsertSnapshot(db, {
    aggregateId: args.aggregateId,
    tenantId: args.tenantId,
    aggregateType: args.aggregateType,
    version: args.version,
    stateJson: JSON.stringify(args.state),
  });
}

// Latest snapshot lookup. Tenant filter is belt-and-suspenders — the
// aggregate_id should already scope uniquely, but an accidentally-reused
// UUID across tenants would otherwise silently leak.
export async function loadLatestSnapshot<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(db: DbRunner, aggregateId: string, tenantId: TenantId): Promise<Snapshot<TState> | null> {
  type SnapRow = {
    aggregateId: string;
    tenantId: TenantId;
    aggregateType: string;
    version: number;
    state: unknown;
    createdAt: Temporal.Instant;
  };
  const rows = await selectMany<SnapRow>(
    db,
    snapshotsTable,
    { aggregateId, tenantId },
    { orderBy: { col: "version", direction: "desc" }, limit: 1 },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    aggregateId: row.aggregateId,
    tenantId: row.tenantId,
    aggregateType: row.aggregateType,
    version: row.version,
    state: row.state as TState, // @cast-boundary engine-payload
    createdAt: row.createdAt,
  };
}

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
};

// Snapshot-aware rehydrate. Loads the latest snapshot (if any), applies
// events strictly newer than snapshot.version, and returns the fold.
// Callers that want strictly-event-sourced loading should stick with
// loadAggregate + reduce — this path exists for perf-critical aggregates.
//
// Archive behaviour mirrors loadAggregate: an archived stream returns
// `initial` with version=0, snapshotHit=false, unless
// { includeArchived: true } is passed. This keeps snapshot and raw
// loadAggregate interchangeable from the caller's point of view.
export async function loadAggregateWithSnapshot<TState extends Record<string, unknown>>(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
  reducer: SnapshotReducer<TState>,
  initial: TState,
  options?: LoadAggregateWithSnapshotOptions,
): Promise<LoadAggregateWithSnapshotResult<TState>> {
  if (!options?.includeArchived) {
    const archived = await isStreamArchived(db, tenantId, aggregateId);
    if (archived) {
      return { state: initial, version: 0, snapshotHit: false };
    }
  }
  const snapshot = await loadLatestSnapshot<TState>(db, aggregateId, tenantId);
  const baseState = snapshot ? snapshot.state : initial;
  const afterVersion = snapshot ? snapshot.version : 0;
  const delta = await loadEventsAfterVersion(db, aggregateId, tenantId, afterVersion);

  let state = baseState;
  for (const event of delta) {
    const effective = options?.upcastEvent ? await options.upcastEvent(event) : event;
    state = reducer(state, effective);
  }
  const lastDelta = delta[delta.length - 1];
  const latestVersion = lastDelta ? lastDelta.version : afterVersion;
  return {
    state,
    version: latestVersion,
    snapshotHit: snapshot !== null,
  };
}
