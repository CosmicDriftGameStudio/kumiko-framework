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
  type ColumnChange,
  describeIndexChange,
  type IndexChange,
  renderAddColumn,
  renderColumnChange,
  whereSqlEqual,
} from "./migrate-change-render.ts";
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

export type { ColumnChange, IndexChange };

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

type MigrationSqlOptions = {
  readonly name: string;
  readonly sequenceNumber: number;
  readonly retiredDrops?: readonly RetiredFrameworkTable[];
  readonly rowLevelSecurityChanges?: readonly RowLevelSecurityChange[];
};

function renderMigrationHeader(options: MigrationSqlOptions): string[] {
  const seq = options.sequenceNumber.toString().padStart(4, "0");
  return [
    `-- Migration ${seq}_${options.name}`,
    `-- Generated: ${new Date().toISOString()}`,
    "-- ",
    "-- This file is generated by `kumiko-schema generate`. You may",
    "-- hand-edit it before committing — add partial-indexes, BRIN-",
    "-- variants, performance-tuning. After commit + apply, NEVER edit",
    "-- this file again (production-DBs already ran it). Write a new",
    "-- migration instead.",
    "",
  ];
}

function renderNewTables(newTables: readonly EntityTableMeta[]): string[] {
  if (newTables.length === 0) return [];
  return ["-- === New tables ===", ...newTables.flatMap((tbl) => [...renderTableDdl(tbl), ""])];
}

function renderRecreatedTable(td: TableDiff): string[] {
  return [
    "-- managed projection — recreated + rebuilt from events (see .rebuild.json)",
    `-- WARN: destructive change (${describeRecreateReasons(td).join("; ")}) forces DROP+CREATE + full event replay.`,
    "-- Consider an Expand/Contract split across two releases to avoid the rebuild — see docs/guides/expand-contract-managed-projections.md.",
    `DROP TABLE IF EXISTS ${quoteIdent(td.tableName)};`,
    ...renderTableDdl(td.nextMeta),
    "",
  ];
}

function renderChangedIndex(td: TableDiff, idxChange: IndexChange): string[] {
  const nextIdxMeta = td.nextMeta.indexes.find((i) => i.name === idxChange.name);
  if (!nextIdxMeta) {
    throw new Error(
      `Index "${idxChange.name}" changed but is missing from the next table meta — generator bug in diffOneTable.`,
    );
  }
  return [
    `-- index ${quoteIdent(idxChange.name)} changed (${describeIndexChange(idxChange)}) — recreated`,
    // needsManualWhere renders CREATE as a commented WARN (renderIndex),
    // since the generator can't express the new WHERE — the DROP has to
    // stay commented too, or the live index gets dropped with no
    // executable replacement.
    nextIdxMeta.needsManualWhere === true
      ? `-- (review) DROP INDEX IF EXISTS ${quoteIdent(idxChange.name)};`
      : `DROP INDEX IF EXISTS ${quoteIdent(idxChange.name)};`,
    renderIndex(td.tableName, nextIdxMeta),
  ];
}

function renderInPlaceTableChanges(td: TableDiff): string[] {
  return [
    ...td.newColumns.map((col) => renderAddColumn(td.tableName, col)),
    ...td.changedColumns.flatMap((ch) => renderColumnChange(td.tableName, ch)),
    ...renderPrimaryKeyChange(td.tableName, td.primaryKeyChanged),
    ...td.newIndexes.map((idx) => renderIndex(td.tableName, idx)),
    ...td.changedIndexes.flatMap((idxChange) => renderChangedIndex(td, idxChange)),
    ...td.droppedIndexes.map((name) => `-- (review) DROP INDEX IF EXISTS ${quoteIdent(name)};`),
    ...td.droppedColumns.map(
      (colName) =>
        `-- DESTRUCTIVE: ALTER TABLE ${quoteIdent(td.tableName)} DROP COLUMN ${quoteIdent(colName)};  -- uncomment + ensure backup`,
    ),
    "",
  ];
}

function renderChangedTables(changedTables: readonly TableDiff[]): string[] {
  if (changedTables.length === 0) return [];
  return [
    "-- === Changed tables ===",
    ...changedTables.flatMap((td) => [
      `-- ${td.tableName}`,
      ...(isRecreatedManagedTable(td) ? renderRecreatedTable(td) : renderInPlaceTableChanges(td)),
    ]),
  ];
}

function renderDroppedTables(droppedTables: readonly string[]): string[] {
  if (droppedTables.length === 0) return [];
  return [
    "-- === Dropped tables ===",
    ...droppedTables.map(
      (name) =>
        `-- DESTRUCTIVE: DROP TABLE IF EXISTS ${quoteIdent(name)};  -- uncomment + ensure backup + run during maintenance window`,
    ),
    "",
  ];
}

function renderRetiredDrops(retiredDrops: readonly RetiredFrameworkTable[]): string[] {
  if (retiredDrops.length === 0) return [];
  return [
    "-- === Retired framework tables ===",
    ...retiredDrops.flatMap((retired) => [
      `-- ${retired.tableName}: retired since framework ${retired.sinceVersion} — ${retired.explanation}`,
      `DROP TABLE IF EXISTS ${quoteIdent(retired.tableName)};`,
    ]),
    "",
  ];
}

// Render the diff as a SQL-file content with header-comment + grouped
// statements. Destructive operations (DROP TABLE/COLUMN, DROP INDEX where
// the index serves performance) are emitted as commented-out statements
// for explicit reviewer-action.
export function renderMigrationSql(diff: SchemaDiff, options: MigrationSqlOptions): string {
  const retiredDrops = options.retiredDrops ?? [];
  const rowLevelSecurityChanges = options.rowLevelSecurityChanges ?? [];
  const lines = [
    ...renderMigrationHeader(options),
    ...renderNewTables(diff.newTables),
    ...renderChangedTables(diff.changedTables),
    ...renderRowLevelSecurityChanges(options.rowLevelSecurityChanges),
    ...renderDroppedTables(diff.droppedTables),
    ...renderRetiredDrops(retiredDrops),
  ];
  if (hasNoSchemaChanges({ diff, retiredDrops, rowLevelSecurityChanges })) {
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
          // guard:dup-ok one template-literal line per row; only the shape matches other renderers
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
