// sql now comes from native dialect

import type {
  LoadAggregateWithSnapshotOptions,
  LoadAggregateWithSnapshotResult,
  SnapshotReducer,
} from "@cosmicdrift/kumiko-types/snapshot-types";
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
import { ensureSnapshotVersionColumn, upsertSnapshot } from "../db/queries/event-store";
import { selectMany } from "../db/query";
import { tableExists } from "../db/schema-inspection";
import type { TenantId } from "../engine/types";
import { unsafePushTables } from "../stack";
import { isStreamArchived } from "./archive";
import { loadEventsAfterVersion } from "./event-store";

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
// Write path: manual via ctx.snapshotAggregate, or automatic via the
// { snapshotEvery: N } load option — the read path persists a fresh
// snapshot whenever it folded at least N delta events.
//
// Schema-migration policy: explicit generations, no reducer hashing. A
// snapshot stores the aggregate state in the reducer's current shape plus
// a caller-declared snapshot_version. Bump { snapshotVersion } when the
// reducer's shape changes — stored snapshots with another generation are
// ignored (full replay through the upcaster chain on events) and restamped
// on the next auto-save. Snapshots stay a perf optimisation, not a source
// of truth.
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
    // Reducer-shape generation — snapshots from another generation are
    // ignored on load. See LoadAggregateWithSnapshotOptions.snapshotVersion.
    snapshotVersion: integer("snapshot_version").notNull().default(sql`1`),
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
  if (await tableExists(db, "public.kumiko_snapshots")) {
    // Installs that predate snapshot_version get healed by the same
    // idempotent ensure that `kumiko schema apply` / test-setup already runs.
    await ensureSnapshotVersionColumn(db);
    // skip: table already ensured — only the column heal above was needed
    return;
  }
  await unsafePushTables(db, { kumikoSnapshots: snapshotsTable });
}

export type Snapshot<TState extends Record<string, unknown> = Record<string, unknown>> = {
  readonly aggregateId: string;
  readonly tenantId: TenantId;
  readonly aggregateType: string;
  readonly version: number;
  readonly state: TState;
  readonly snapshotVersion: number;
  readonly createdAt: Temporal.Instant;
};

export type SaveSnapshotArgs = {
  readonly aggregateId: string;
  readonly tenantId: TenantId;
  readonly aggregateType: string;
  readonly version: number;
  readonly state: Record<string, unknown>;
  // Reducer-shape generation (default 1) — see LoadAggregateWithSnapshotOptions.
  readonly snapshotVersion?: number;
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
    state: args.state,
    snapshotVersion: args.snapshotVersion ?? 1,
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
    snapshotVersion: number;
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
    snapshotVersion: row.snapshotVersion,
    createdAt: row.createdAt,
  };
}

export type {
  LoadAggregateWithSnapshotOptions,
  LoadAggregateWithSnapshotResult,
  SnapshotReducer,
} from "@cosmicdrift/kumiko-types/snapshot-types";

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
  if (
    options?.snapshotEvery !== undefined &&
    (!Number.isInteger(options.snapshotEvery) || options.snapshotEvery < 1)
  ) {
    throw new Error(
      `loadAggregateWithSnapshot: snapshotEvery must be an integer >= 1, got ${String(options.snapshotEvery)}`,
    );
  }
  if (!options?.includeArchived) {
    const archived = await isStreamArchived(db, tenantId, aggregateId);
    if (archived) {
      return { state: initial, version: 0, snapshotHit: false };
    }
  }
  const shapeVersion = options?.snapshotVersion ?? 1;
  const stored = await loadLatestSnapshot<TState>(db, aggregateId, tenantId);
  const snapshot = stored && stored.snapshotVersion === shapeVersion ? stored : null;
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
  if (options?.snapshotEvery !== undefined && lastDelta && delta.length >= options.snapshotEvery) {
    try {
      await saveSnapshot(db, {
        aggregateId,
        tenantId,
        aggregateType: lastDelta.aggregateType,
        version: latestVersion,
        state,
        snapshotVersion: shapeVersion,
      });
    } catch {
      // Best-effort cache write — losing it only costs the next load a replay.
    }
  }
  return {
    state,
    version: latestVersion,
    snapshotHit: snapshot !== null,
  };
}
