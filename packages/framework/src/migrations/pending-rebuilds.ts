// Persistent pending-rebuild queue for the `kumiko schema apply` path.
//
// Problem: Apps read rebuild markers only from `result.applied` for the
// CURRENT apply round. If the projection rebuild failed (or the process
// crashed in between), the marker reference was gone on the next apply —
// `applied` was empty — leaving the projection silently incomplete without a
// self-service retry path.
//
// Solution: persist the affected tables in `kumiko_pending_rebuilds` BEFORE
// the rebuild and delete them only after the associated projection rebuild
// succeeds. A subsequent apply, even without new migrations, processes open
// rebuilds through `runPendingRebuilds`.

import type { DbConnection } from "../db/connection.ts";
import { instant, table as pgTable, sql, text } from "../db/dialect.ts";
import { deleteMany, selectMany, upsertOnConflict } from "../db/query.ts";
import { readRebuildMarker } from "../db/rebuild-marker.ts";
import { tableExists } from "../db/schema-inspection.ts";
import { unsafePushTables } from "../db/table-push.ts";
import type { Registry } from "../engine/types/index.ts";
import type { JobRunner } from "../jobs/index.ts";
import type { Logger } from "../logging/types.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { rebuildMultiStreamProjection, rebuildProjection } from "../pipeline/index.ts";
import type { RebuildResult } from "../pipeline/projection-rebuild.ts";

import { buildProjectionTableIndex } from "./projection-table-index.ts";

export const pendingRebuildsTable = pgTable("kumiko_pending_rebuilds", {
  tableName: text("table_name").primaryKey(),
  migrationId: text("migration_id").notNull(),
  queuedAt: instant("queued_at", { precision: 3 }).notNull().default(sql`now()`),
});

export async function createPendingRebuildsTable(db: DbConnection): Promise<void> {
  // skip: table already exists — bootstrap runs from multiple paths
  if (await tableExists(db, "public.kumiko_pending_rebuilds")) return;
  await unsafePushTables(db, { kumikoPendingRebuilds: pendingRebuildsTable });
}

/** Reads rebuild markers from freshly applied migrations and queues the
 *  affected tables. Upsert: an already-pending table keeps its queue slot
 *  (`queued_at` remains unchanged, preserving order), while `migration_id`
 *  points to the latest migration that flagged it for debugging. */
export async function queueRebuildsFromMarkers(
  db: DbConnection,
  options: { readonly migrationsDir: string; readonly appliedIds: readonly string[] },
): Promise<readonly string[]> {
  await createPendingRebuildsTable(db);
  const queued = new Set<string>();
  for (const migrationId of options.appliedIds) {
    for (const tableName of readRebuildMarker(options.migrationsDir, migrationId)) {
      await upsertOnConflict(
        db,
        pendingRebuildsTable,
        { tableName, migrationId },
        { conflictKeys: ["tableName"], update: { migrationId } },
      );
      queued.add(tableName);
    }
  }
  return [...queued];
}

type PendingRebuildRow = { readonly tableName: string; readonly migrationId: string };

export async function listPendingRebuildRows(
  db: DbConnection,
): Promise<readonly PendingRebuildRow[]> {
  await createPendingRebuildsTable(db);
  const rows = await selectMany<PendingRebuildRow>(db, pendingRebuildsTable, undefined, {
    orderBy: [{ col: "queuedAt" }, { col: "tableName" }],
  });
  return rows.map((row) => ({ tableName: row.tableName, migrationId: row.migrationId }));
}

export async function listPendingRebuilds(db: DbConnection): Promise<readonly string[]> {
  return (await listPendingRebuildRows(db)).map((row) => row.tableName);
}

// Clears against the (table_name, migration_id) snapshot the caller read, not
// table_name alone: a concurrent queueRebuildsFromMarkers can re-queue the same
// table for a NEWER migration (upsert bumps migration_id, keeps the slot)
// between the read and the clear. Scoping the delete to the snapshot's
// migration_id leaves that fresh re-queue intact instead of dropping it.
export async function clearPendingRebuilds(
  db: DbConnection,
  rows: readonly PendingRebuildRow[],
): Promise<void> {
  for (const { tableName, migrationId } of rows) {
    await deleteMany(db, pendingRebuildsTable, { tableName, migrationId });
  }
}

export type PendingRebuildRun = {
  /** Projections rebuilt successfully (queue entries removed). */
  readonly rebuilt: readonly { readonly projection: string; readonly eventsProcessed: number }[];
  /** Fehlgeschlagene Projektionen — ihre Tabellen BLEIBEN pending. */
  readonly failed: readonly { readonly projection: string; readonly error: string }[];
  /** Pending tables without a registered projection that are either NOT
   *  freshly emptied via marker in this run (pre-existing / legacy unmanaged
   *  marker) OR were deliberately DROPped by a later migration in the same
   *  run (no data loss, no projection left to resolve) — drained, silent. */
  readonly unmapped: readonly string[];
  /** Managed tables emptied by a marker in THIS run without a resolvable
   *  projection, indicating that the owning feature is missing from the
   *  composition. They are drained to avoid a stuck loop, but logged loudly
   *  because the projection is now empty. */
  readonly unresolvedManaged: readonly string[];
};

export type RunPendingRebuildsOptions = {
  /** Tables freshly queued via markers in THIS apply run
   *  (returned by `queueRebuildsFromMarkers`). Markers contain only managed
   *  tables, so one without a resolvable projection is a real defect (a
   *  missing feature) and is reported loudly instead of being silently
   *  drained. Without this option, every unmapped table is treated as
   *  pre-existing and benign. */
  readonly thisRunTables?: readonly string[];
};

// buildProjectionTableIndex maps both single-stream and multi-stream projection
// tables to their name, so the rebuild has to pick the matching path. Callers
// (queue drains, inline enqueue, the manual rebuild job) all rethrow the error,
// so it is recorded there; a failed MSP replay rolls back and must not park
// the still-intact live consumer as dead.
export async function rebuildProjectionOrMultiStream(
  name: string,
  deps: {
    readonly db: DbConnection;
    readonly registry: Registry;
    readonly signal?: AbortSignal;
    // MSPs take their skip mode from the declaration (msp.errorMode), no override.
    readonly errorPolicy?: { readonly skipApplyErrors?: boolean };
    readonly logger?: Pick<Logger, "error"> & Partial<Pick<Logger, "warn" | "debug">>;
  },
): Promise<RebuildResult> {
  const { db, registry, signal, errorPolicy } = deps;
  if (registry.getAllMultiStreamProjections().has(name)) {
    if (errorPolicy?.skipApplyErrors === true) {
      createFallbackLogger("migrations:pending-rebuilds", deps.logger).warn(
        `skipApplyErrors ignored for multi-stream projection "${name}"; declare msp.errorMode.rebuild instead`,
        { projection: name },
      );
    }
    return rebuildMultiStreamProjection(name, {
      db,
      registry,
      markDeadOnFailure: false,
      ...(signal && { signal }),
    });
  }
  return rebuildProjection(name, {
    db,
    registry,
    ...(signal && { signal }),
    ...(errorPolicy && { errorPolicy }),
  });
}

/** Logs a finished queue drain and throws when any projection failed; the
 *  failed tables stay queued. Shared by every `schema apply` entry point so the
 *  report and the error text cannot drift apart. */
export function reportPendingRebuildRun(run: PendingRebuildRun, log: (line: string) => void): void {
  if (run.rebuilt.length > 0) {
    log(`  Rebuild ${run.rebuilt.length} Projection(s)…`);
    for (const r of run.rebuilt) {
      log(`    ↻ ${r.projection} (${r.eventsProcessed} events)`);
    }
    log("");
  }
  if (run.failed.length > 0) {
    throw new Error(
      `Projection rebuild failed for: ${run.failed
        .map((f) => `${f.projection} (${f.error})`)
        .join("; ")}. Table(s) stay queued in kumiko_pending_rebuilds — retried on the next apply.`,
    );
  }
}

/** Processes the persistent queue: maps tables to projections, rebuilds each
 *  affected projection, and removes its tables from the queue only after
 *  SUCCESS. Failed tables remain pending and are retried by the next apply
 *  (or a direct re-call). Unmapped tables are drained to avoid a stuck loop;
 *  managed tables freshly emptied in this run without a projection are also
 *  reported through `unresolvedManaged`. */
export async function runPendingRebuilds(
  db: DbConnection,
  registry: Registry,
  options: RunPendingRebuildsOptions = {},
): Promise<PendingRebuildRun> {
  const pendingRows = await listPendingRebuildRows(db);
  if (pendingRows.length === 0) {
    return { rebuilt: [], failed: [], unmapped: [], unresolvedManaged: [] };
  }
  // (table → migration) snapshot read together with the table list; the clear
  // below scopes its DELETE to this migration_id so a concurrent re-queue for a
  // newer migration survives instead of being dropped.
  const migrationByTable = new Map(pendingRows.map((r) => [r.tableName, r.migrationId]));
  const snapshotRows = (tables: readonly string[]): readonly PendingRebuildRow[] =>
    tables.flatMap((tableName) => {
      const migrationId = migrationByTable.get(tableName);
      return migrationId === undefined ? [] : [{ tableName, migrationId }];
    });
  const pending = pendingRows.map((r) => r.tableName);

  const tableToProjection = buildProjectionTableIndex(registry);
  const thisRun = new Set(options.thisRunTables ?? []);
  const byProjection = new Map<string, string[]>();
  const unmapped: string[] = [];
  const unresolvedManaged: string[] = [];
  for (const tableName of pending) {
    const projection = tableToProjection.get(tableName);
    if (projection === undefined) {
      // Markers only carry managed tables (rebuild-marker.ts). A table emptied
      // in THIS run with no resolving projection is a real defect (owning
      // feature missing from the composition) → loud — unless the table
      // no longer exists: then a later migration in the same run deliberately
      // DROPped it after migrating its data elsewhere, no data loss. Pre-
      // existing pending tables stay indistinguishable from old unmanaged
      // markers → still drain silently as before.
      if (thisRun.has(tableName) && (await tableExists(db, `public.${tableName}`))) {
        unresolvedManaged.push(tableName);
      } else {
        unmapped.push(tableName);
      }
      continue;
    }
    byProjection.set(projection, [...(byProjection.get(projection) ?? []), tableName]);
  }

  // Both classes are drained: the queue must not grow indefinitely, and a
  // re-apply must not remain stuck. The distinction is conveyed through the
  // log and return field rather than by leaving entries queued.
  const drained = [...unmapped, ...unresolvedManaged];
  if (drained.length > 0) {
    await clearPendingRebuilds(db, snapshotRows(drained));
  }

  if (unresolvedManaged.length > 0) {
    createFallbackLogger("migrations:pending-rebuilds").error(
      `${unresolvedManaged.length} managed projection table(s) emptied by a migration in this run have no registered projection — the owning feature is likely missing from the composition. They are now EMPTY and were NOT rebuilt: ${unresolvedManaged.join(", ")}. Restore the owning feature or rebuild the projection manually.`,
      { tables: unresolvedManaged },
    );
  }

  const rebuilt: { projection: string; eventsProcessed: number }[] = [];
  const failed: { projection: string; error: string }[] = [];
  for (const [projection, tables] of byProjection) {
    try {
      const result = await rebuildProjectionOrMultiStream(projection, { db, registry });
      await clearPendingRebuilds(db, snapshotRows(tables));
      rebuilt.push({ projection, eventsProcessed: result.eventsProcessed });
    } catch (e) {
      failed.push({ projection, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { rebuilt, failed, unmapped, unresolvedManaged };
}

// Registered by the `jobs` bundled-feature; a jobs-less boot has no jobRunner and rebuilds inline instead.
export const PROJECTION_REBUILD_JOB = "jobs:job:projection-rebuild";

export type EnqueueProjectionRebuildResult =
  | { readonly mode: "dispatched"; readonly bullJobId: string }
  | { readonly mode: "inline"; readonly result: RebuildResult };

export type EnqueueProjectionRebuildDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  // Present + projection-rebuild job registered (jobs composed) → tracked,
  // retryable job (store_job_runs + store_job_run_logs). Absent → inline rebuild.
  readonly jobRunner?: JobRunner;
};

// Capability detection via registry.getJob (NOT hasFeature) — deterministic, no toggle-runtime dependency.
export async function enqueueProjectionRebuild(
  projection: string,
  deps: EnqueueProjectionRebuildDeps,
): Promise<EnqueueProjectionRebuildResult> {
  const { db, registry, jobRunner } = deps;
  if (jobRunner !== undefined && registry.getJob(PROJECTION_REBUILD_JOB) !== undefined) {
    const bullJobId = await jobRunner.dispatch(PROJECTION_REBUILD_JOB, { projection });
    return { mode: "dispatched", bullJobId };
  }
  const result = await rebuildProjectionOrMultiStream(projection, { db, registry });
  return { mode: "inline", result };
}
