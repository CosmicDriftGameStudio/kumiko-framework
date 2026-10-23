// Row level security part of the migration generator: diffs the per-table policy
// specs between two snapshots and renders the resulting DDL section.

import {
  isSameTableRowLevelSecurity,
  renderDisableRowLevelSecurity,
  renderEnableRowLevelSecurity,
  type TableRowLevelSecurity,
} from "./render-rls-ddl.ts";
import { quoteIdent } from "./sql-identifier.ts";

export type RowLevelSecurityChange =
  | {
      readonly kind: "enable";
      readonly tableName: string;
      readonly next: TableRowLevelSecurity;
      readonly previous?: TableRowLevelSecurity;
    }
  | {
      readonly kind: "disable";
      readonly tableName: string;
      readonly previous: TableRowLevelSecurity;
    };

type RowLevelSecuritySnapshotView = {
  readonly tables: readonly { readonly tableName: string }[];
  readonly rowLevelSecurity?: Readonly<Record<string, TableRowLevelSecurity>>;
};

function specOf(
  view: RowLevelSecuritySnapshotView | null,
  tableName: string,
): TableRowLevelSecurity | undefined {
  const byTable = view?.rowLevelSecurity;
  if (byTable === undefined || !Object.hasOwn(byTable, tableName)) return undefined;
  return byTable[tableName];
}

function changeForTable(
  tableName: string,
  previous: RowLevelSecuritySnapshotView | null,
  next: RowLevelSecuritySnapshotView,
  recreatedTables: ReadonlySet<string>,
): RowLevelSecurityChange | undefined {
  const nextSpec = specOf(next, tableName);
  const previousSpec = specOf(previous, tableName);
  const recreated = recreatedTables.has(tableName);
  if (nextSpec !== undefined) {
    const unchanged =
      previousSpec !== undefined &&
      !recreated &&
      isSameTableRowLevelSecurity(previousSpec, nextSpec);
    if (unchanged) return undefined;
    return {
      kind: "enable",
      tableName,
      next: nextSpec,
      ...(previousSpec !== undefined && !recreated && { previous: previousSpec }),
    };
  }
  const existedBefore = previous?.tables.some((table) => table.tableName === tableName) === true;
  if (previousSpec !== undefined && existedBefore && !recreated) {
    return { kind: "disable", tableName, previous: previousSpec };
  }
  return undefined;
}

export function diffRowLevelSecurity(
  previous: RowLevelSecuritySnapshotView | null,
  next: RowLevelSecuritySnapshotView,
  recreatedTables: ReadonlySet<string>,
): RowLevelSecurityChange[] {
  const changes: RowLevelSecurityChange[] = [];
  for (const { tableName } of next.tables) {
    const change = changeForTable(tableName, previous, next, recreatedTables);
    if (change !== undefined) changes.push(change);
  }
  return changes;
}

function renderChange(change: RowLevelSecurityChange): string[] {
  const tableSql = quoteIdent(change.tableName);
  if (change.kind === "enable") {
    return renderEnableRowLevelSecurity(tableSql, change.next, change.previous);
  }
  return [
    "-- WARN: row level security switched off, tenant isolation falls back to the application layer",
    ...renderDisableRowLevelSecurity(tableSql, change.previous),
  ];
}

export function renderRowLevelSecurityChanges(
  changes: readonly RowLevelSecurityChange[] = [],
): string[] {
  if (changes.length === 0) return [];
  return [
    "-- === Row level security ===",
    ...changes.flatMap((change) => [`-- ${change.tableName}`, ...renderChange(change)]),
    "",
  ];
}
