// Framework tables that a framework release stopped creating and whose data
// was explicitly declared dispensable. `kumiko schema generate` drops them
// for real (instead of the commented-out DESTRUCTIVE marker app tables get),
// because the framework — not the app — owns the decision that the data is
// gone. Without this, every app carried a stale table forever behind a
// commented drop nobody uncomments.
//
// Add an entry only when the release notes state the data is not preserved.
// A rename is NOT a retirement: the data lives on under the new name.

import type { Snapshot } from "./migrate-generator.js";

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

const IDENT = `"?([^"\\s(;,.]+)"?`;
const CREATE_TABLE_RE = new RegExp(`^CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${IDENT}`, "i");
const DROP_TABLE_RE = new RegExp(`^DROP TABLE\\s+(?:IF EXISTS\\s+)?${IDENT}`, "i");
const COMMENTED_DROP_TABLE_RE = new RegExp(
  `^--\\s*DESTRUCTIVE:\\s*DROP TABLE\\s+(?:IF EXISTS\\s+)?${IDENT}`,
  "i",
);

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
      const dropped = DROP_TABLE_RE.exec(line)?.[1];
      if (dropped !== undefined) states.set(dropped, "dropped");
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
