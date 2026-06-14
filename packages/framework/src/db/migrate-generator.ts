// Build-time Generator: EntityTableMeta[] → reviewbares SQL-Migration-File.
// Ersatz für `drizzle-kit generate`.
//
// **NO-MAGIC-ON-DATA Kernprinzip** (siehe drizzle-replacement.md):
//   - Generator emittiert SQL-Files für PR-Review/Edit
//   - Generator wird NIE zur App-Runtime aufgerufen
//   - Output ist Start-Form; App-Author darf das SQL hand-editieren
//     (BRIN-Index, partial-Index, performance-tuning) bevor committed
//   - Append-only: bestehende Migration-Files werden NIE überschrieben.
//     Neue Schema-Diffs landen in einem NEUEN File mit incrementierter
//     Sequence-Number.
//
// **DESTRUCTIVE-ops** (DROP TABLE/COLUMN, INDEX-removal) werden als
// AUSKOMMENTIERTE statements emittiert — Reviewer muss explizit
// uncommenten + ggf. Data-Backup-Schritt vorlauf einfügen. Default:
// niemals automatisch droppen.

import { readFileSync, writeFileSync } from "node:fs";

import type { ColumnMeta, EntityTableMeta, IndexMeta } from "./entity-table-meta";
import { renderTableDdl } from "./render-ddl";

const SNAPSHOT_VERSION = 1 as const;

export type Snapshot = {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly generatedAt: string; // ISO-8601
  readonly tables: readonly EntityTableMeta[];
};

export type ColumnChange = {
  readonly name: string;
  readonly nullabilityChanged?: { readonly from: boolean; readonly to: boolean };
  readonly defaultChanged?: { readonly from: string | undefined; readonly to: string | undefined };
  readonly typeChanged?: { readonly from: string; readonly to: string };
};

export type TableDiff = {
  readonly tableName: string;
  readonly newColumns: readonly ColumnMeta[];
  readonly droppedColumns: readonly string[];
  readonly changedColumns: readonly ColumnChange[];
  readonly newIndexes: readonly IndexMeta[];
  readonly droppedIndexes: readonly string[];
  // Full target meta — carried so the renderer can emit DROP+CREATE for a
  // managed projection whose change cannot apply in-place (see
  // managedChangeRequiresRecreate). Source-discriminator reached via nextMeta.source.
  readonly nextMeta: EntityTableMeta;
};

export type SchemaDiff = {
  readonly newTables: readonly EntityTableMeta[];
  readonly droppedTables: readonly string[];
  readonly changedTables: readonly TableDiff[];
};

export function snapshotFromMetas(metas: readonly EntityTableMeta[]): Snapshot {
  // Stable ordering by tableName so the snapshot.json diff in PRs is
  // meaningful (table-add isn't a noisy re-sort of everything).
  const sorted = [...metas].sort((a, b) => a.tableName.localeCompare(b.tableName));
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    tables: sorted,
  };
}

export function loadSnapshotJson(path: string): Snapshot | null {
  try {
    const text = readFileSync(path, "utf8");
    const parsed = JSON.parse(text) as { version?: unknown };
    if (parsed.version !== SNAPSHOT_VERSION) {
      throw new Error(
        `Snapshot at ${path} has version ${String(parsed.version)}, expected ${SNAPSHOT_VERSION}`,
      );
    }
    return parsed as Snapshot;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function writeSnapshotJson(path: string, snapshot: Snapshot): void {
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function indexMetaKey(idx: IndexMeta): string {
  // Index-Identität via Name (PG-Constraint: unique innerhalb der DB)
  return idx.name;
}

function columnsByName(meta: EntityTableMeta): Map<string, ColumnMeta> {
  const m = new Map<string, ColumnMeta>();
  for (const c of meta.columns) m.set(c.name, c);
  return m;
}

function indexesByName(meta: EntityTableMeta): Map<string, IndexMeta> {
  const m = new Map<string, IndexMeta>();
  for (const i of meta.indexes) m.set(indexMetaKey(i), i);
  return m;
}

function diffOneTable(prev: EntityTableMeta, next: EntityTableMeta): TableDiff | null {
  const prevCols = columnsByName(prev);
  const nextCols = columnsByName(next);

  const newColumns: ColumnMeta[] = [];
  const droppedColumns: string[] = [];
  const changedColumns: ColumnChange[] = [];

  for (const [name, nextCol] of nextCols) {
    const prevCol = prevCols.get(name);
    if (!prevCol) {
      newColumns.push(nextCol);
      continue;
    }
    const change: ColumnChange = { name };
    if (prevCol.notNull !== nextCol.notNull) {
      Object.assign(change, {
        nullabilityChanged: { from: prevCol.notNull, to: nextCol.notNull },
      });
    }
    if (prevCol.defaultSql !== nextCol.defaultSql) {
      Object.assign(change, {
        defaultChanged: { from: prevCol.defaultSql, to: nextCol.defaultSql },
      });
    }
    if (prevCol.pgType !== nextCol.pgType) {
      Object.assign(change, {
        typeChanged: { from: prevCol.pgType, to: nextCol.pgType },
      });
    }
    if (change.nullabilityChanged || change.defaultChanged || change.typeChanged) {
      changedColumns.push(change);
    }
  }
  for (const name of prevCols.keys()) {
    if (!nextCols.has(name)) droppedColumns.push(name);
  }

  const prevIdx = indexesByName(prev);
  const nextIdx = indexesByName(next);
  const newIndexes: IndexMeta[] = [];
  const droppedIndexes: string[] = [];
  for (const [name, idx] of nextIdx) {
    if (!prevIdx.has(name)) newIndexes.push(idx);
  }
  for (const name of prevIdx.keys()) {
    if (!nextIdx.has(name)) droppedIndexes.push(name);
  }

  const isEmpty =
    newColumns.length === 0 &&
    droppedColumns.length === 0 &&
    changedColumns.length === 0 &&
    newIndexes.length === 0 &&
    droppedIndexes.length === 0;
  if (isEmpty) return null;
  return {
    tableName: prev.tableName,
    newColumns,
    droppedColumns,
    changedColumns,
    newIndexes,
    droppedIndexes,
    nextMeta: next,
  };
}

export function diffSnapshots(prev: Snapshot | null, next: Snapshot): SchemaDiff {
  const prevByName = new Map<string, EntityTableMeta>();
  if (prev) {
    for (const t of prev.tables) prevByName.set(t.tableName, t);
  }
  const nextByName = new Map<string, EntityTableMeta>();
  for (const t of next.tables) nextByName.set(t.tableName, t);

  const newTables: EntityTableMeta[] = [];
  const droppedTables: string[] = [];
  const changedTables: TableDiff[] = [];

  for (const [name, nextMeta] of nextByName) {
    const prevMeta = prevByName.get(name);
    if (!prevMeta) {
      newTables.push(nextMeta);
      continue;
    }
    const td = diffOneTable(prevMeta, nextMeta);
    if (td) changedTables.push(td);
  }
  for (const name of prevByName.keys()) {
    if (!nextByName.has(name)) droppedTables.push(name);
  }

  return { newTables, droppedTables, changedTables };
}

// A managed projection is a disposable derivative of the event stream. When a
// schema change cannot apply in-place against existing rows — NOT NULL without
// default, a UNIQUE index (may hit duplicates), SET NOT NULL, a type change, or
// a dropped column (incl. the drop-half of a rename) — the additive ALTER would
// die on the very rows the queued rebuild discards anyway. Such a change is
// rendered as DROP+CREATE and refilled from events instead. Purely additive,
// in-place-safe changes (nullable/defaulted ADD, non-unique index, DROP NOT
// NULL, default-only) stay as cheap ALTERs with no forced replay.
export function managedChangeRequiresRecreate(td: TableDiff): boolean {
  if (td.droppedColumns.length > 0) return true;
  if (td.newColumns.some((c) => c.notNull && c.defaultSql === undefined)) return true;
  if (td.newIndexes.some((idx) => idx.unique === true)) return true;
  return td.changedColumns.some(
    (c) => c.nullabilityChanged?.to === true || c.typeChanged !== undefined,
  );
}

// --- SQL-Render ---------------------------------------------------------

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderColumnInline(col: ColumnMeta): string {
  const parts: string[] = [quoteIdent(col.name), col.pgType];
  if (col.defaultSql !== undefined) parts.push(`DEFAULT ${col.defaultSql}`);
  if (col.notNull) parts.push("NOT NULL");
  return parts.join(" ");
}

function renderAddColumn(tableName: string, col: ColumnMeta): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${renderColumnInline(col)};`;
}

function renderColumnChange(tableName: string, change: ColumnChange): readonly string[] {
  const out: string[] = [];
  const col = quoteIdent(change.name);
  const tbl = quoteIdent(tableName);
  if (change.nullabilityChanged) {
    const op = change.nullabilityChanged.to ? "SET NOT NULL" : "DROP NOT NULL";
    out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} ${op};`);
  }
  if (change.defaultChanged) {
    if (change.defaultChanged.to !== undefined) {
      out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} SET DEFAULT ${change.defaultChanged.to};`);
    } else {
      out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} DROP DEFAULT;`);
    }
  }
  if (change.typeChanged) {
    // pg ALTER TYPE braucht oft USING-clause für nicht-implicit-castable
    // type-changes. Wir emittieren das als Reviewer-Kommentar + raw cast —
    // App-Author muss prüfen ob das gewünscht ist.
    out.push(
      `-- WARN: column-type-change ${change.typeChanged.from} → ${change.typeChanged.to}. Review USING-clause if needed.`,
    );
    out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${change.typeChanged.to};`);
  }
  return out;
}

function renderIndex(tableName: string, idx: IndexMeta): string {
  const kind = idx.unique === true ? "UNIQUE INDEX" : "INDEX";
  const colList = idx.columns.map(quoteIdent).join(", ");
  const where = idx.whereSql !== undefined ? ` WHERE ${idx.whereSql}` : "";
  return `CREATE ${kind} IF NOT EXISTS ${quoteIdent(idx.name)} ON ${quoteIdent(tableName)} (${colList})${where};`;
}

// Render the diff as a SQL-file content with header-comment + grouped
// statements. Destructive operations (DROP TABLE/COLUMN, DROP INDEX where
// the index serves performance) are emitted as commented-out statements
// for explicit reviewer-action.
export function renderMigrationSql(
  diff: SchemaDiff,
  options: { readonly name: string; readonly sequenceNumber: number },
): string {
  const lines: string[] = [];
  const seq = options.sequenceNumber.toString().padStart(4, "0");
  lines.push(`-- Migration ${seq}_${options.name}`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push("-- ");
  lines.push("-- This file is generated by `kumiko migrate generate`. You may");
  lines.push("-- hand-edit it before committing — add partial-indexes, BRIN-");
  lines.push("-- variants, performance-tuning. After commit + apply, NEVER edit");
  lines.push("-- this file again (production-DBs already ran it). Write a new");
  lines.push("-- migration instead.");
  lines.push("");

  if (diff.newTables.length > 0) {
    lines.push("-- === New tables ===");
    for (const tbl of diff.newTables) {
      lines.push(...renderTableDdl(tbl));
      lines.push("");
    }
  }

  if (diff.changedTables.length > 0) {
    lines.push("-- === Changed tables ===");
    for (const td of diff.changedTables) {
      lines.push(`-- ${td.tableName}`);
      if (td.nextMeta.source === "managed" && managedChangeRequiresRecreate(td)) {
        lines.push("-- managed projection — recreated + rebuilt from events (see .rebuild.json)");
        lines.push(`DROP TABLE IF EXISTS ${quoteIdent(td.tableName)};`);
        lines.push(...renderTableDdl(td.nextMeta));
        lines.push("");
        continue;
      }
      for (const col of td.newColumns) {
        lines.push(renderAddColumn(td.tableName, col));
      }
      for (const ch of td.changedColumns) {
        for (const stmt of renderColumnChange(td.tableName, ch)) lines.push(stmt);
      }
      for (const idx of td.newIndexes) {
        lines.push(renderIndex(td.tableName, idx));
      }
      for (const name of td.droppedIndexes) {
        lines.push(`-- (review) DROP INDEX IF EXISTS ${quoteIdent(name)};`);
      }
      for (const colName of td.droppedColumns) {
        lines.push(
          `-- DESTRUCTIVE: ALTER TABLE ${quoteIdent(td.tableName)} DROP COLUMN ${quoteIdent(colName)};  -- uncomment + ensure backup`,
        );
      }
      lines.push("");
    }
  }

  if (diff.droppedTables.length > 0) {
    lines.push("-- === Dropped tables ===");
    for (const name of diff.droppedTables) {
      lines.push(
        `-- DESTRUCTIVE: DROP TABLE IF EXISTS ${quoteIdent(name)};  -- uncomment + ensure backup + run during maintenance window`,
      );
    }
    lines.push("");
  }

  if (
    diff.newTables.length === 0 &&
    diff.changedTables.length === 0 &&
    diff.droppedTables.length === 0
  ) {
    lines.push("-- No schema changes detected.");
  }

  return lines.join("\n");
}

// --- High-level entry point --------------------------------------------

export type GenerateMigrationInput = {
  readonly metas: readonly EntityTableMeta[];
  readonly prevSnapshot: Snapshot | null;
  readonly name: string;
  readonly sequenceNumber: number;
};

export type GenerateMigrationOutput = {
  readonly filename: string;
  readonly sqlContent: string;
  readonly snapshot: Snapshot;
  readonly diff: SchemaDiff;
};

export function generateMigration(input: GenerateMigrationInput): GenerateMigrationOutput {
  const nextSnapshot = snapshotFromMetas(input.metas);
  const diff = diffSnapshots(input.prevSnapshot, nextSnapshot);
  const sqlContent = renderMigrationSql(diff, {
    name: input.name,
    sequenceNumber: input.sequenceNumber,
  });
  const seq = input.sequenceNumber.toString().padStart(4, "0");
  return {
    filename: `${seq}_${input.name}.sql`,
    sqlContent,
    snapshot: nextSnapshot,
    diff,
  };
}
