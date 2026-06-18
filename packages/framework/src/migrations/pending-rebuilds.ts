// Persistente Pending-Rebuild-Queue für den `kumiko schema apply`-Pfad.
//
// Problem (studio#36/#46): Apps lasen die rebuild-Marker nur für
// `result.applied` der AKTUELLEN apply-Runde. Schlug der Projection-Rebuild
// fehl (oder crashte der Prozess dazwischen), war der Marker-Bezug beim
// nächsten apply weg — `applied` ist dann leer — und die Projektion blieb
// stillschweigend unfertig, ohne Self-Service-Retry-Pfad.
//
// Lösung: die betroffenen Tabellen werden VOR dem Rebuild in
// `kumiko_pending_rebuilds` persistiert und erst nach erfolgreichem Rebuild
// der zugehörigen Projektion gelöscht. Ein erneuter apply (auch ohne neue
// Migrations) holt offene Rebuilds über `runPendingRebuilds` nach.

import type { DbConnection } from "../db/connection";
import { instant, table as pgTable, sql, text } from "../db/dialect";
import { deleteMany, selectMany, upsertOnConflict } from "../db/query";
import { readRebuildMarker } from "../db/rebuild-marker";
import { tableExists } from "../db/schema-inspection";
import type { Registry } from "../engine/types";
import type { JobRunner } from "../jobs";
import { createFallbackLogger } from "../logging/utils";
import { type RebuildResult, rebuildProjection } from "../pipeline";
import { unsafePushTables } from "../stack";
import { buildProjectionTableIndex } from "./projection-table-index";

export const pendingRebuildsTable = pgTable("kumiko_pending_rebuilds", {
  tableName: text("table_name").primaryKey(),
  migrationId: text("migration_id").notNull(),
  queuedAt: instant("queued_at", { precision: 3 }).notNull().default(sql`now()`),
});

export async function createPendingRebuildsTable(db: DbConnection): Promise<void> {
  // skip: table already exists — bootstrap läuft aus mehreren Pfaden
  if (await tableExists(db, "public.kumiko_pending_rebuilds")) return;
  await unsafePushTables(db, { kumikoPendingRebuilds: pendingRebuildsTable });
}

/** Liest die rebuild-Marker der frisch applizierten Migrations und queued
 *  die betroffenen Tabellen. Upsert: ein bereits pending-er Tisch behält
 *  seinen Queue-Slot (queued_at bleibt, damit die Reihenfolge stabil ist) —
 *  migration_id zeigt auf die zuletzt flaggende Migration (Debug-Bezug). */
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

type PendingRebuildRow = { readonly tableName: string };

export async function listPendingRebuilds(db: DbConnection): Promise<readonly string[]> {
  await createPendingRebuildsTable(db);
  const rows = await selectMany<PendingRebuildRow>(db, pendingRebuildsTable, undefined, {
    orderBy: [{ col: "queuedAt" }, { col: "tableName" }],
  });
  return rows.map((row) => row.tableName);
}

async function clearPendingRebuilds(db: DbConnection, tables: readonly string[]): Promise<void> {
  for (const tableName of tables) {
    await deleteMany(db, pendingRebuildsTable, { tableName });
  }
}

export type PendingRebuildRun = {
  /** Erfolgreich rebuildte Projektionen (Queue-Einträge geräumt). */
  readonly rebuilt: readonly { readonly projection: string; readonly eventsProcessed: number }[];
  /** Fehlgeschlagene Projektionen — ihre Tabellen BLEIBEN pending. */
  readonly failed: readonly { readonly projection: string; readonly error: string }[];
  /** Pending-Tabellen ohne registrierte Projektion, die NICHT in diesem Run
   *  frisch via Marker geleert wurden (pre-existing / Legacy-unmanaged-Marker)
   *  — geräumt, still (nicht von echten Legacy-Tabellen unterscheidbar). */
  readonly unmapped: readonly string[];
  /** In DIESEM Run via Marker geleerte managed-Tabellen ohne auflösbare
   *  Projektion = das owning-Feature fehlt in der Komposition. Geräumt (kein
   *  Stuck-Loop), aber LAUT geloggt — die Projektion ist jetzt leer. */
  readonly unresolvedManaged: readonly string[];
};

export type RunPendingRebuildsOptions = {
  /** Tabellen, die in DIESEM apply-Run frisch via Marker gequeued wurden
   *  (Rückgabe von `queueRebuildsFromMarkers`). Marker tragen nur managed
   *  Tabellen — eine davon ohne auflösbare Projektion ist ein echter Defekt
   *  (fehlendes Feature) und wird laut gemeldet statt still geleert. Fehlt die
   *  Option, wird jede unmapped Tabelle als pre-existing/benign behandelt
   *  (Verhalten vor #361). */
  readonly thisRunTables?: readonly string[];
};

/** Arbeitet die persistierte Queue ab: mappt Tabellen auf Projektionen,
 *  rebuildet jede betroffene Projektion und räumt ihre Tabellen erst nach
 *  ERFOLG aus der Queue. Fehlgeschlagene bleiben pending — der nächste
 *  apply (oder ein direkter Re-Call) holt sie nach. Unmapped-Tabellen werden
 *  geräumt (kein Stuck-Loop); die in diesem Run frisch geleerten managed-
 *  Tabellen ohne Projektion zusätzlich laut gemeldet (`unresolvedManaged`). */
export async function runPendingRebuilds(
  db: DbConnection,
  registry: Registry,
  options: RunPendingRebuildsOptions = {},
): Promise<PendingRebuildRun> {
  const pending = await listPendingRebuilds(db);
  if (pending.length === 0) {
    return { rebuilt: [], failed: [], unmapped: [], unresolvedManaged: [] };
  }

  const tableToProjection = buildProjectionTableIndex(registry);
  const thisRun = new Set(options.thisRunTables ?? []);
  const byProjection = new Map<string, string[]>();
  const unmapped: string[] = [];
  const unresolvedManaged: string[] = [];
  for (const tableName of pending) {
    const projection = tableToProjection.get(tableName);
    if (projection === undefined) {
      // Marker tragen nur managed Tabellen (rebuild-marker.ts). Eine in DIESEM
      // Run frisch geleerte Tabelle ohne auflösbare Projektion ist daher ein
      // echter Defekt (owning-Feature fehlt in der Komposition) → laut. Pre-
      // existing pending Tabellen sind nicht von alten unmanaged-Markern
      // unterscheidbar → still drainen wie bisher (kein Hard-Throw, siehe #361).
      if (thisRun.has(tableName)) unresolvedManaged.push(tableName);
      else unmapped.push(tableName);
      continue;
    }
    byProjection.set(projection, [...(byProjection.get(projection) ?? []), tableName]);
  }

  // Beide Klassen räumen: die Queue darf nicht ewig wachsen, und ein Re-Apply
  // darf nicht sticky-stuck werfen. Die Lautstärke liegt im Log + Return-Feld,
  // nicht im Liegenlassen.
  const drained = [...unmapped, ...unresolvedManaged];
  if (drained.length > 0) {
    await clearPendingRebuilds(db, drained);
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
      const result = await rebuildProjection(projection, { db, registry });
      await clearPendingRebuilds(db, tables);
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
  // retryable job (read_job_runs + read_job_run_logs). Absent → inline rebuild.
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
  const result = await rebuildProjection(projection, { db, registry });
  return { mode: "inline", result };
}
