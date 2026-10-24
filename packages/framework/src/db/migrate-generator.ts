// Build-time generator: EntityTableMeta[] → reviewable SQL migration file.
// Replacement for `drizzle-kit generate`.
//
// **NO-MAGIC-ON-DATA core principle** (see drizzle-replacement.md):
//   - The generator emits SQL files for PR review/editing.
//   - The generator is NEVER called at app runtime.
//   - The output is a starting point; app authors may hand-edit the SQL
//     (BRIN index, partial index, performance tuning) before committing.
//   - Append-only: existing migration files are NEVER overwritten.
//     New schema diffs go into a NEW file with an incremented sequence number.
//
// **DESTRUCTIVE operations** (DROP TABLE/COLUMN, index removal) are emitted
// as commented-out statements — reviewers must explicitly uncomment them
// and may need to add a data-backup step beforehand. Default:
// never drop automatically.

import { readFileSync, writeFileSync } from "node:fs";
import { errorCodeOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { compareByCodepoint } from "../utils/compare.ts";

import type { ColumnMeta, EntityTableMeta, IndexMeta } from "./entity-table-meta.ts";
import {
  diffPrimaryKey,
  type PrimaryKeyChange,
  renderPrimaryKeyChange,
} from "./migrate-primary-key.ts";
import {
  diffRowLevelSecurity,
  type RowLevelSecurityChange,
  renderRowLevelSecurityChanges,
} from "./migrate-rls-diff.ts";
import { renderIndex, renderTableDdl } from "./render-ddl.ts";
import {
  isTableRowLevelSecurityRecord,
  type RowLevelSecurityMode,
  rowLevelSecurityByTable,
  type TableRowLevelSecurity,
} from "./render-rls-ddl.ts";
import { findRetiredTableDrops, type RetiredFrameworkTable } from "./retired-framework-tables.ts";
import { quoteIdent } from "./sql-identifier.ts";

const SNAPSHOT_VERSION = 1 as const;

export type Snapshot = {
  readonly version: typeof SNAPSHOT_VERSION;
  // ISO-8601. Optional because hand-written and older snapshots omit it; nothing reads it.
  readonly generatedAt?: string;
  readonly tables: readonly EntityTableMeta[];
  // Only written with rowLevelSecurity "on"; absent means the app does not use RLS.
  readonly rowLevelSecurity?: Readonly<Record<string, TableRowLevelSecurity>>;
};

function isSnapshot(value: unknown): value is Snapshot {
  return (
    isPlainObject(value) &&
    value["version"] === SNAPSHOT_VERSION &&
    (value["generatedAt"] === undefined || typeof value["generatedAt"] === "string") &&
    Array.isArray(value["tables"]) &&
    (value["rowLevelSecurity"] === undefined ||
      isTableRowLevelSecurityRecord(value["rowLevelSecurity"]))
  );
}

export type ColumnChange = {
  readonly name: string;
  readonly nullabilityChanged?: { readonly from: boolean; readonly to: boolean };
  readonly defaultChanged?: { readonly from: string | undefined; readonly to: string | undefined };
  readonly typeChanged?: { readonly from: string; readonly to: string };
};

export type IndexChange = {
  readonly name: string;
  readonly columnsChanged?: { readonly from: readonly string[]; readonly to: readonly string[] };
  readonly uniqueChanged?: { readonly from: boolean; readonly to: boolean };
  readonly whereSqlChanged?: { readonly from: string | undefined; readonly to: string | undefined };
  readonly needsManualWhereChanged?: { readonly from: boolean; readonly to: boolean };
};

export type TableDiff = {
  readonly tableName: string;
  readonly newColumns: readonly ColumnMeta[];
  readonly droppedColumns: readonly string[];
  readonly changedColumns: readonly ColumnChange[];
  readonly newIndexes: readonly IndexMeta[];
  readonly droppedIndexes: readonly string[];
  // Same-named index whose shape (columns/unique/whereSql/needsManualWhere)
  // changed — recreated via DROP+CREATE rather than silently absorbed into
  // the new snapshot with no emitted DDL.
  readonly changedIndexes: readonly IndexChange[];
  readonly primaryKeyChanged?: PrimaryKeyChange;
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

export function snapshotFromMetas(
  metas: readonly EntityTableMeta[],
  options: { readonly rowLevelSecurity?: RowLevelSecurityMode } = {},
): Snapshot {
  // Stable ordering by tableName so the snapshot.json diff in PRs is
  // meaningful (table-add isn't a noisy re-sort of everything). Codepoint, not
  // localeCompare: the snapshot is serialized to byte-exact JSON and the table
  // order carries into the generated migration SQL — locale-dependent ordering
  // would drift between macOS-dev and Linux-CI.
  const sorted = [...metas].sort((a, b) => compareByCodepoint(a.tableName, b.tableName));
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    tables: sorted,
    ...(options.rowLevelSecurity === "on" && {
      rowLevelSecurity: rowLevelSecurityByTable(sorted),
    }),
  };
}

export function loadSnapshotJson(path: string): Snapshot | null {
  try {
    const text = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    const version = isPlainObject(parsed) ? parsed["version"] : undefined;
    if (version !== SNAPSHOT_VERSION) {
      throw new Error(
        `Snapshot at ${path} has version ${String(version)}, expected ${SNAPSHOT_VERSION}`,
      );
    }
    if (!isSnapshot(parsed)) {
      throw new Error(`Snapshot at ${path} is malformed: expected a tables list`);
    }
    return parsed;
  } catch (err) {
    if (errorCodeOf(err) === "ENOENT") return null;
    throw err;
  }
}

export function writeSnapshotJson(path: string, snapshot: Snapshot): void {
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function indexMetaKey(idx: IndexMeta): string {
  // Index identity is based on its name (PostgreSQL constraint: unique within the database).
  return idx.name;
}

function indexColumnsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((col, i) => col === b[i]);
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

type FromTo<T> = { readonly from: T; readonly to: T };

type KeyedDiff<T, C> = {
  readonly added: readonly T[];
  readonly dropped: readonly string[];
  readonly changed: readonly C[];
};

function strictEqual<T>(a: T, b: T): boolean {
  return a === b;
}

function fromToWhenDifferent<T>(
  from: T,
  to: T,
  isEqual: (a: T, b: T) => boolean = strictEqual,
): FromTo<T> | undefined {
  return isEqual(from, to) ? undefined : { from, to };
}

// added and changed follow next's order, dropped follows prev's order; the
// rendered migration depends on both.
function diffByName<T, C>(
  prev: ReadonlyMap<string, T>,
  next: ReadonlyMap<string, T>,
  compare: (name: string, prevItem: T, nextItem: T) => C | undefined,
): KeyedDiff<T, C> {
  const added: T[] = [];
  const changed: C[] = [];
  for (const [name, nextItem] of next) {
    const prevItem = prev.get(name);
    if (prevItem === undefined) {
      added.push(nextItem);
      continue;
    }
    const change = compare(name, prevItem, nextItem);
    if (change !== undefined) changed.push(change);
  }
  const dropped = [...prev.keys()].filter((name) => !next.has(name));
  return { added, dropped, changed };
}

function compareColumns(
  name: string,
  prevCol: ColumnMeta,
  nextCol: ColumnMeta,
): ColumnChange | undefined {
  const nullabilityChanged = fromToWhenDifferent(prevCol.notNull, nextCol.notNull);
  const defaultChanged = fromToWhenDifferent(prevCol.defaultSql, nextCol.defaultSql);
  const typeChanged = fromToWhenDifferent(prevCol.pgType, nextCol.pgType);
  if (!nullabilityChanged && !defaultChanged && !typeChanged) return undefined;
  return {
    name,
    ...(nullabilityChanged && { nullabilityChanged }),
    ...(defaultChanged && { defaultChanged }),
    ...(typeChanged && { typeChanged }),
  };
}

function compareIndexes(
  name: string,
  prevIndex: IndexMeta,
  nextIndex: IndexMeta,
): IndexChange | undefined {
  const columnsChanged = fromToWhenDifferent(
    prevIndex.columns,
    nextIndex.columns,
    indexColumnsEqual,
  );
  const uniqueChanged = fromToWhenDifferent(prevIndex.unique ?? false, nextIndex.unique ?? false);
  // Whitespace-only re-rendering of the predicate must not drop and rebuild a large index.
  const whereSqlChanged = fromToWhenDifferent(
    prevIndex.whereSql,
    nextIndex.whereSql,
    whereSqlEqual,
  );
  const needsManualWhereChanged = fromToWhenDifferent(
    prevIndex.needsManualWhere ?? false,
    nextIndex.needsManualWhere ?? false,
  );
  if (!columnsChanged && !uniqueChanged && !whereSqlChanged && !needsManualWhereChanged) {
    return undefined;
  }
  // Single literal typed as IndexChange so a misspelled key fails to compile instead of silently dropping the change.
  return {
    name,
    ...(columnsChanged && { columnsChanged }),
    ...(uniqueChanged && { uniqueChanged }),
    ...(whereSqlChanged && { whereSqlChanged }),
    ...(needsManualWhereChanged && { needsManualWhereChanged }),
  };
}

function hasNoTableChanges(diff: TableDiff): boolean {
  return (
    diff.primaryKeyChanged === undefined &&
    [
      diff.newColumns,
      diff.droppedColumns,
      diff.changedColumns,
      diff.newIndexes,
      diff.droppedIndexes,
      diff.changedIndexes,
    ].every((list) => list.length === 0)
  );
}

function diffOneTable(prev: EntityTableMeta, next: EntityTableMeta): TableDiff | null {
  const columns = diffByName(columnsByName(prev), columnsByName(next), compareColumns);
  const indexes = diffByName(indexesByName(prev), indexesByName(next), compareIndexes);
  const primaryKeyChanged = diffPrimaryKey(prev, next);
  const diff: TableDiff = {
    tableName: prev.tableName,
    newColumns: columns.added,
    droppedColumns: columns.dropped,
    changedColumns: columns.changed,
    newIndexes: indexes.added,
    droppedIndexes: indexes.dropped,
    changedIndexes: indexes.changed,
    ...(primaryKeyChanged && { primaryKeyChanged }),
    nextMeta: next,
  };
  return hasNoTableChanges(diff) ? null : diff;
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

// Managed projections are event-stream derivatives: in-place-unsafe changes (NOT NULL w/o default, UNIQUE, SET NOT NULL, type change, dropped col) → DROP+CREATE + replay; additive-safe changes stay cheap ALTERs.
function describeRecreateReasons(td: TableDiff): readonly string[] {
  const reasons: string[] = [];
  if (td.droppedColumns.length > 0) {
    reasons.push(`dropped column(s): ${td.droppedColumns.join(", ")}`);
  }
  const notNullNoDefault = td.newColumns
    .filter((c) => c.notNull && c.defaultSql === undefined)
    .map((c) => c.name);
  if (notNullNoDefault.length > 0) {
    reasons.push(`new NOT NULL column(s) without default: ${notNullNoDefault.join(", ")}`);
  }
  const newUniqueIndexes = td.newIndexes
    .filter((idx) => idx.unique === true)
    .map((idx) => idx.name);
  if (newUniqueIndexes.length > 0) {
    reasons.push(`new UNIQUE index(es): ${newUniqueIndexes.join(", ")}`);
  }
  // A changed index that ends up UNIQUE (newly unique, new columns, widened WHERE) can fail on existing duplicates in place.
  const uniqueNextNames = new Set(
    td.nextMeta.indexes.filter((idx) => idx.unique === true).map((idx) => idx.name),
  );
  const changedToUnique = td.changedIndexes
    .filter((c) => uniqueNextNames.has(c.name))
    .map((c) => c.name);
  if (changedToUnique.length > 0) {
    reasons.push(`changed UNIQUE index(es): ${changedToUnique.join(", ")}`);
  }
  const madeNotNull = td.changedColumns
    .filter((c) => c.nullabilityChanged?.to === true)
    .map((c) => c.name);
  if (madeNotNull.length > 0) {
    reasons.push(`column(s) set NOT NULL: ${madeNotNull.join(", ")}`);
  }
  const typeChanged = td.changedColumns
    .filter((c) => c.typeChanged !== undefined)
    .map((c) => c.name);
  if (typeChanged.length > 0) {
    reasons.push(`column type change: ${typeChanged.join(", ")}`);
  }
  if (td.primaryKeyChanged) {
    const { from, to } = td.primaryKeyChanged;
    reasons.push(`primary-key change: ${from.columns.join(", ")} → ${to.columns.join(", ")}`);
  }
  return reasons;
}

export function managedChangeRequiresRecreate(td: TableDiff): boolean {
  return describeRecreateReasons(td).length > 0;
}

export function isRecreatedManagedTable(td: TableDiff): boolean {
  return td.nextMeta.source === "managed" && managedChangeRequiresRecreate(td);
}

export function hasNoSchemaChanges(input: {
  readonly diff: SchemaDiff;
  readonly retiredDrops: readonly RetiredFrameworkTable[];
  readonly rowLevelSecurityChanges: readonly RowLevelSecurityChange[];
}): boolean {
  return (
    input.diff.newTables.length === 0 &&
    input.diff.changedTables.length === 0 &&
    input.diff.droppedTables.length === 0 &&
    input.retiredDrops.length === 0 &&
    input.rowLevelSecurityChanges.length === 0
  );
}

// --- SQL-Render ---------------------------------------------------------

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
    const { from, to } = change.typeChanged;
    // timestamptz → date: PG's implicit ::date cast (what a bare ALTER ...
    // TYPE without USING falls back to) reads the session TimeZone, so the
    // same row migrates to a different calendar day depending on who/where
    // runs it. Anchor explicitly at UTC instead of trusting the session.
    if ((from === "timestamptz" || from === "timestamptz(3)") && to === "date") {
      out.push(
        `-- ${from} → date: explicit UTC anchor — a bare cast would use the session TimeZone (non-deterministic).`,
      );
      out.push(
        `ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE date USING (${col} AT TIME ZONE 'UTC')::date;`,
      );
    } else if (from === "date" && (to === "timestamptz" || to === "timestamptz(3)")) {
      // Same non-determinism, reversed: a bare `date → timestamptz` cast
      // interprets the calendar date at session-TimeZone midnight. Anchor
      // explicitly at UTC midnight instead.
      out.push(
        `-- date → ${to}: explicit UTC anchor — a bare cast would use the session TimeZone (non-deterministic).`,
      );
      out.push(
        `ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${to} USING (${col}::timestamp AT TIME ZONE 'UTC');`,
      );
    } else {
      // pg ALTER TYPE often needs a USING clause for non-implicitly-castable
      // type changes. Emitted as a reviewer comment + raw cast — the app
      // author has to confirm it's intended.
      out.push(`-- WARN: column-type-change ${from} → ${to}. Review USING-clause if needed.`);
      out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${to};`);
    }
  }
  return out;
}

// Collapses whitespace so a multi-line whereSql (e.g. a two-condition
// drizzle sql`…` predicate) can't inject a newline into this `--` comment
// line and escape into the executable body of the generated migration.
function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function whereSqlEqual(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return toSingleLine(a) === toSingleLine(b);
}

function describeIndexChange(change: IndexChange): string {
  const parts: string[] = [];
  if (change.columnsChanged) {
    parts.push(
      `columns (${change.columnsChanged.from.join(", ")}) → (${change.columnsChanged.to.join(", ")})`,
    );
  }
  if (change.uniqueChanged) {
    parts.push(`unique ${change.uniqueChanged.from} → ${change.uniqueChanged.to}`);
  }
  if (change.whereSqlChanged) {
    const from =
      change.whereSqlChanged.from !== undefined
        ? toSingleLine(change.whereSqlChanged.from)
        : "<none>";
    const to =
      change.whereSqlChanged.to !== undefined ? toSingleLine(change.whereSqlChanged.to) : "<none>";
    parts.push(`where ${from} → ${to}`);
  }
  if (change.needsManualWhereChanged) {
    parts.push(
      `needs-manual-where ${change.needsManualWhereChanged.from} → ${change.needsManualWhereChanged.to}`,
    );
  }
  return parts.join("; ");
}

// Render the diff as a SQL-file content with header-comment + grouped
// statements. Destructive operations (DROP TABLE/COLUMN, DROP INDEX where
// the index serves performance) are emitted as commented-out statements
// for explicit reviewer-action.
export function renderMigrationSql(
  diff: SchemaDiff,
  options: {
    readonly name: string;
    readonly sequenceNumber: number;
    readonly retiredDrops?: readonly RetiredFrameworkTable[];
    readonly rowLevelSecurityChanges?: readonly RowLevelSecurityChange[];
  },
): string {
  const retiredDrops = options.retiredDrops ?? [];
  const lines: string[] = [];
  const seq = options.sequenceNumber.toString().padStart(4, "0");
  lines.push(`-- Migration ${seq}_${options.name}`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push("-- ");
  lines.push("-- This file is generated by `kumiko-schema generate`. You may");
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
      if (isRecreatedManagedTable(td)) {
        lines.push("-- managed projection — recreated + rebuilt from events (see .rebuild.json)");
        lines.push(
          `-- WARN: destructive change (${describeRecreateReasons(td).join("; ")}) forces DROP+CREATE + full event replay.`,
        );
        lines.push(
          "-- Consider an Expand/Contract split across two releases to avoid the rebuild — see docs/guides/expand-contract-managed-projections.md.",
        );
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
      lines.push(...renderPrimaryKeyChange(td.tableName, td.primaryKeyChanged));
      for (const idx of td.newIndexes) {
        lines.push(renderIndex(td.tableName, idx));
      }
      for (const idxChange of td.changedIndexes) {
        const nextIdxMeta = td.nextMeta.indexes.find((i) => i.name === idxChange.name);
        if (!nextIdxMeta) {
          throw new Error(
            `Index "${idxChange.name}" changed but is missing from the next table meta — generator bug in diffOneTable.`,
          );
        }
        lines.push(
          `-- index ${quoteIdent(idxChange.name)} changed (${describeIndexChange(idxChange)}) — recreated`,
        );
        // needsManualWhere renders CREATE as a commented WARN (renderIndex),
        // since the generator can't express the new WHERE — the DROP has to
        // stay commented too, or the live index gets dropped with no
        // executable replacement.
        lines.push(
          nextIdxMeta.needsManualWhere === true
            ? `-- (review) DROP INDEX IF EXISTS ${quoteIdent(idxChange.name)};`
            : `DROP INDEX IF EXISTS ${quoteIdent(idxChange.name)};`,
        );
        lines.push(renderIndex(td.tableName, nextIdxMeta));
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

  lines.push(...renderRowLevelSecurityChanges(options.rowLevelSecurityChanges));

  if (diff.droppedTables.length > 0) {
    lines.push("-- === Dropped tables ===");
    for (const name of diff.droppedTables) {
      lines.push(
        `-- DESTRUCTIVE: DROP TABLE IF EXISTS ${quoteIdent(name)};  -- uncomment + ensure backup + run during maintenance window`,
      );
    }
    lines.push("");
  }

  if (retiredDrops.length > 0) {
    lines.push("-- === Retired framework tables ===");
    for (const retired of retiredDrops) {
      lines.push(
        `-- ${retired.tableName}: retired since framework ${retired.sinceVersion} — ${retired.explanation}`,
      );
      lines.push(`DROP TABLE IF EXISTS ${quoteIdent(retired.tableName)};`);
    }
    lines.push("");
  }

  if (
    hasNoSchemaChanges({
      diff,
      retiredDrops,
      rowLevelSecurityChanges: options.rowLevelSecurityChanges ?? [],
    })
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
  /** Raw SQL of all earlier migrations, in order — lets the generator decide
   *  whether a retired framework table still needs its executable drop. */
  readonly priorMigrationsSql?: readonly string[];
  readonly rowLevelSecurity?: RowLevelSecurityMode;
};

export type GenerateMigrationOutput = {
  readonly filename: string;
  readonly sqlContent: string;
  readonly snapshot: Snapshot;
  readonly diff: SchemaDiff;
  readonly retiredDrops: readonly RetiredFrameworkTable[];
  readonly rowLevelSecurityChanges: readonly RowLevelSecurityChange[];
};

// Shared allowlist for migration names — used by the CLI and by
// generateMigration so a programmatic caller cannot skip the check and
// smuggle path segments / newlines into the filename or SQL header.
export const MIGRATION_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function assertValidMigrationName(name: string): void {
  if (!MIGRATION_NAME_RE.test(name)) {
    throw new Error(
      `Invalid migration name "${name}" — must start with a letter or digit, then letters/digits/"-"/"_" only (max 64 chars).`,
    );
  }
}

export function assertUniqueTableNames(metas: readonly EntityTableMeta[]): void {
  const counts = new Map<string, number>();
  for (const { tableName } of metas) counts.set(tableName, (counts.get(tableName) ?? 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    throw new Error(
      duplicates
        .map(
          ([tableName, count]) =>
            `ENTITY_METAS lists table "${tableName}" ${count} times — the migration diff would silently use only one definition. collectTableMetas(features) already includes every table a feature registers (r.storeTable, entities, projections); remove the duplicate entry for "${tableName}" (a hand-added meta, or two features registering the same table).`,
        )
        .join("\n"),
    );
  }
}

export function generateMigration(input: GenerateMigrationInput): GenerateMigrationOutput {
  assertValidMigrationName(input.name);
  assertUniqueTableNames(input.metas);
  const nextSnapshot = snapshotFromMetas(input.metas, { rowLevelSecurity: input.rowLevelSecurity });
  const diff = diffSnapshots(input.prevSnapshot, nextSnapshot);
  const recreatedTables = new Set(
    diff.changedTables.filter(isRecreatedManagedTable).map((td) => td.tableName),
  );
  const rowLevelSecurityChanges = diffRowLevelSecurity(
    input.prevSnapshot,
    nextSnapshot,
    recreatedTables,
  );
  const retiredDrops = findRetiredTableDrops(input.priorMigrationsSql ?? [], nextSnapshot);
  const sqlContent = renderMigrationSql(diff, {
    name: input.name,
    sequenceNumber: input.sequenceNumber,
    retiredDrops,
    rowLevelSecurityChanges,
  });
  const seq = input.sequenceNumber.toString().padStart(4, "0");
  return {
    filename: `${seq}_${input.name}.sql`,
    sqlContent,
    snapshot: nextSnapshot,
    diff,
    retiredDrops,
    rowLevelSecurityChanges,
  };
}
