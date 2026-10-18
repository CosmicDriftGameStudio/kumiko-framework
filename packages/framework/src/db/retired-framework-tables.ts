// Framework tables that a framework release stopped creating and whose data
// was explicitly declared dispensable. `kumiko schema generate` drops them
// for real (instead of the commented-out DESTRUCTIVE marker app tables get),
// because the framework — not the app — owns the decision that the data is
// gone. Without this, every app carried a stale table forever behind a
// commented drop nobody uncomments.
//
// Add an entry only when the release notes state the data is not preserved.
// A rename is NOT a retirement: the data lives on under the new name.

import type { Snapshot } from "./migrate-generator.ts";

export type RetiredFrameworkTable = {
  readonly tableName: string;
  readonly sinceVersion: string;
  readonly explanation: string;
};

export const retiredFrameworkTables: readonly RetiredFrameworkTable[] = [
  {
    tableName: "read_job_runs",
    sinceVersion: "0.210.0",
    explanation:
      "replaced by store_job_runs; the job run history was not migrated (operational data, not a system of record)",
  },
];

type TableLifecycleState = "created" | "commented-drop" | "dropped";

// Optional schema prefix is skipped; only the table name is captured.
const IDENT = `(?:"?[^"\\s(;,.]+"?\\.)?"?([^"\\s(;,.]+)"?`;
const CREATE_TABLE_RE = new RegExp(`^CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${IDENT}`, "i");
// DROP TABLE accepts a comma list; the list is split and each entry parsed with IDENT.
const DROP_TABLE_LIST_RE = /^DROP TABLE\s+(?:IF EXISTS\s+)?([^;]+)/i;
const IDENT_ONLY_RE = new RegExp(`^\\s*${IDENT}`);
const RENAME_TABLE_RE = new RegExp(
  `^ALTER TABLE\\s+(?:IF EXISTS\\s+)?(?:ONLY\\s+)?${IDENT}\\s+RENAME TO\\s+${IDENT}`,
  "i",
);
const COMMENTED_DROP_TABLE_RE = new RegExp(
  `^--\\s*DESTRUCTIVE:\\s*DROP TABLE\\s+(?:IF EXISTS\\s+)?${IDENT}`,
  "i",
);

function droppedTableNames(line: string): readonly string[] {
  const list = DROP_TABLE_LIST_RE.exec(line)?.[1];
  if (list === undefined) return [];
  return list
    .split(",")
    .map((entry) => IDENT_ONLY_RE.exec(entry)?.[1])
    .filter((name): name is string => name !== undefined);
}

// Last known state per table across all migrations, in order — so a
// DROP followed by a re-CREATE (managed-projection recreate) counts as
// "created", and a commented drop followed by an executable one as "dropped".
function scanTableLifecycle(sqlTexts: readonly string[]): ReadonlyMap<string, TableLifecycleState> {
  const states = new Map<string, TableLifecycleState>();
  for (const text of sqlTexts) {
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      const commentedDrop = COMMENTED_DROP_TABLE_RE.exec(line)?.[1];
      if (commentedDrop !== undefined) {
        states.set(commentedDrop, "commented-drop");
        continue;
      }
      if (line.startsWith("--")) continue;
      const created = CREATE_TABLE_RE.exec(line)?.[1];
      if (created !== undefined) {
        states.set(created, "created");
        continue;
      }
      const renamed = RENAME_TABLE_RE.exec(line);
      if (renamed?.[1] !== undefined && renamed[2] !== undefined) {
        states.set(renamed[1], "dropped");
        states.set(renamed[2], "created");
        continue;
      }
      for (const dropped of droppedTableNames(line)) states.set(dropped, "dropped");
    }
  }
  return states;
}

function snapshotHasTable(snapshot: Snapshot | null, tableName: string): boolean {
  return snapshot?.tables.some((t) => t.tableName === tableName) ?? false;
}

// Retired tables the next migration must drop: a migration created them (or
// carries a commented drop), none dropped them for real, and the schema no
// longer declares them.
export function findRetiredTableDrops(
  priorMigrationsSql: readonly string[],
  nextSnapshot: Snapshot,
): readonly RetiredFrameworkTable[] {
  const states = scanTableLifecycle(priorMigrationsSql);
  return retiredFrameworkTables.filter((retired) => {
    const state = states.get(retired.tableName);
    return (
      (state === "created" || state === "commented-drop") &&
      !snapshotHasTable(nextSnapshot, retired.tableName)
    );
  });
}

// Tables a migration only carries as a commented DESTRUCTIVE drop although
// the snapshot no longer has them: if they still exist in the live DB, the
// drop was never made.
export function findCommentedDropTables(
  migrationsSql: readonly string[],
  snapshot: Snapshot | null,
): readonly string[] {
  return [...scanTableLifecycle(migrationsSql)]
    .filter(
      ([tableName, state]) => state === "commented-drop" && !snapshotHasTable(snapshot, tableName),
    )
    .map(([tableName]) => tableName);
}

export function isRetiredFrameworkTable(tableName: string): boolean {
  return retiredFrameworkTables.some((retired) => retired.tableName === tableName);
}
