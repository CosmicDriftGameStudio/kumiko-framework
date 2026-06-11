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
import { rebuildProjection } from "../pipeline";
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
  const queued: string[] = [];
  for (const migrationId of options.appliedIds) {
    for (const tableName of readRebuildMarker(options.migrationsDir, migrationId)) {
      await upsertOnConflict(
        db,
        pendingRebuildsTable,
        { tableName, migrationId },
        { conflictKeys: ["tableName"], update: { migrationId } },
      );
      queued.push(tableName);
    }
  }
  return queued;
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
  /** Pending-Tabellen ohne registrierte Projektion — geräumt (kein Rebuild-Sinn). */
  readonly unmapped: readonly string[];
};

/** Arbeitet die persistierte Queue ab: mappt Tabellen auf Projektionen,
 *  rebuildet jede betroffene Projektion und räumt ihre Tabellen erst nach
 *  ERFOLG aus der Queue. Fehlgeschlagene bleiben pending — der nächste
 *  apply (oder ein direkter Re-Call) holt sie nach. */
export async function runPendingRebuilds(
  db: DbConnection,
  registry: Registry,
): Promise<PendingRebuildRun> {
  const pending = await listPendingRebuilds(db);
  if (pending.length === 0) return { rebuilt: [], failed: [], unmapped: [] };

  const tableToProjection = buildProjectionTableIndex(registry);
  const byProjection = new Map<string, string[]>();
  const unmapped: string[] = [];
  for (const tableName of pending) {
    const projection = tableToProjection.get(tableName);
    if (projection === undefined) {
      unmapped.push(tableName);
      continue;
    }
    byProjection.set(projection, [...(byProjection.get(projection) ?? []), tableName]);
  }

  // Tabellen ohne Projektion: gleiche Semantik wie der bisherige Skip beim
  // Apply — aber explizit geräumt, damit die Queue nicht ewig wächst.
  if (unmapped.length > 0) {
    await clearPendingRebuilds(db, unmapped);
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
  return { rebuilt, failed, unmapped };
}
